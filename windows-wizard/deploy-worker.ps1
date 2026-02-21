param(
    [Parameter(Mandatory = $true)][string]$RunId,
    [Parameter(Mandatory = $true)][string]$RequestPath,
    [Parameter(Mandatory = $true)][string]$StateDir,
    [Parameter(Mandatory = $true)][string]$WizardRoot
)

$ErrorActionPreference = 'Stop'

. (Join-Path $WizardRoot 'deploy-core.ps1')

$logPath = Join-Path $StateDir "$RunId.log"
$statusPath = Join-Path $StateDir "$RunId.status.json"

function Set-Status {
    param(
        [string]$State,
        [string]$Message,
        [object]$Result = $null
    )

    $obj = @{
        runId = $RunId
        state = $State
        message = $Message
        updatedAt = (Get-Date).ToString('o')
        result = $Result
    }

    $obj | ConvertTo-Json -Depth 15 | Set-Content -Path $statusPath -Encoding UTF8
}

function Add-Log {
    param([string]$Message)
    $line = "[$((Get-Date).ToString('u'))] $Message"
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

try {
    Set-Status -State 'running' -Message 'Deployment started.'
    Add-Log 'Deployment worker started.'

    $request = Get-Content -Path $RequestPath -Raw | ConvertFrom-Json
    $projectId = [string]$request.projectId
    $region = if ($request.region) { [string]$request.region } else { 'us-central1' }
    $serviceAccountPath = [string]$request.serviceAccountPath
    $memoryMb = 1024
    $timeoutSeconds = 120
    if ($request.memoryMb) { [void][int]::TryParse([string]$request.memoryMb, [ref]$memoryMb) }
    if ($request.timeoutSeconds) { [void][int]::TryParse([string]$request.timeoutSeconds, [ref]$timeoutSeconds) }

    $functionSourcePath = Join-Path $WizardRoot 'function-source'

    Add-Log "Input: projectId=$projectId region=$region memoryMb=$memoryMb timeoutSeconds=$timeoutSeconds"
    Add-Log "Input: serviceAccountPath=$serviceAccountPath"
    Add-Log "Input: functionSourcePath=$functionSourcePath"

    $result = Invoke-FunctionDeployment `
        -ProjectId $projectId `
        -Region $region `
        -ServiceAccountPath $serviceAccountPath `
        -MemoryMb $memoryMb `
        -TimeoutSeconds $timeoutSeconds `
        -FunctionSourcePath $functionSourcePath `
        -Log ${function:Add-Log}

    Add-Log $result.message
    Set-Status -State 'success' -Message $result.message -Result $result.data
}
catch {
    $err = $_.Exception.Message
    $stack = $_.ScriptStackTrace
    Add-Log "ERROR: $err"
    if (-not [string]::IsNullOrWhiteSpace($stack)) {
        Add-Log "STACK: $stack"
    }
    Set-Status -State 'failed' -Message $err
}
