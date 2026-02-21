$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'deploy-core.ps1')

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Read-Value {
    param(
        [string]$Prompt,
        [string]$Default = ''
    )

    if ([string]::IsNullOrWhiteSpace($Default)) {
        return (Read-Host $Prompt).Trim()
    }

    $value = (Read-Host "$Prompt [$Default]").Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

try {
    Write-Host 'SAP Content Server - Windows Deploy Wizard (No Dev Tools Required)' -ForegroundColor Green

    $projectId = Read-Value -Prompt 'Firebase/GCP Project ID'
    if ([string]::IsNullOrWhiteSpace($projectId)) { throw 'Project ID is required.' }

    $region = Read-Value -Prompt 'Functions region' -Default 'us-central1'
    $serviceAccountPath = Read-Value -Prompt 'Path to service-account JSON'
    if ([string]::IsNullOrWhiteSpace($serviceAccountPath)) { throw 'Service account path is required.' }

    $memoryMbInput = Read-Value -Prompt 'Memory MB' -Default '1024'
    $timeoutInput = Read-Value -Prompt 'Timeout seconds' -Default '120'

    [int]$memoryMb = 1024
    [int]$timeoutSeconds = 120
    [void][int]::TryParse($memoryMbInput, [ref]$memoryMb)
    [void][int]::TryParse($timeoutInput, [ref]$timeoutSeconds)

    $functionSourcePath = Join-Path $PSScriptRoot 'function-source'

    $result = Invoke-FunctionDeployment `
        -ProjectId $projectId `
        -Region $region `
        -ServiceAccountPath $serviceAccountPath `
        -MemoryMb $memoryMb `
        -TimeoutSeconds $timeoutSeconds `
        -FunctionSourcePath $functionSourcePath `
        -Log ${function:Write-Step}

    Write-Host "`nFunction deployed: $($result.data.functionName)" -ForegroundColor Green
    Write-Host "Project: $($result.data.projectId)"
    Write-Host "Region: $($result.data.region)"
    Write-Host "URL: $($result.data.url)"
    Write-Host "Health: $($result.data.healthUrl)"

    exit 0
}
catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
