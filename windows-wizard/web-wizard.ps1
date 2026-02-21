$ErrorActionPreference = 'Stop'

$wizardRoot = Split-Path -Parent $PSCommandPath
$webRoot = Join-Path $wizardRoot 'web'
$stateDir = Join-Path $wizardRoot 'runtime'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

. (Join-Path $wizardRoot 'deploy-core.ps1')

$preferredPorts = @(5065, 5066, 5067, 5075)
$listener = $null
$prefix = $null
$startErrors = @()

foreach ($port in $preferredPorts) {
    $candidatePrefix = "http://127.0.0.1:$port/"
    $candidateListener = [System.Net.HttpListener]::new()
    $candidateListener.Prefixes.Add($candidatePrefix)

    try {
        $candidateListener.Start()
        $listener = $candidateListener
        $prefix = $candidatePrefix
        break
    }
    catch {
        $startErrors += "${candidatePrefix} -> $($_.Exception.Message)"
        try { $candidateListener.Close() } catch { }
    }
}

if ($null -eq $listener -or [string]::IsNullOrWhiteSpace($prefix)) {
    throw "Could not start web wizard listener on any preferred port. Tried: $($startErrors -join ' | ')"
}

Get-Job -Name 'sap-deploy-*' -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue

function Write-JsonResponse {
    param($Response, [int]$StatusCode, [object]$Body)
    $json = $Body | ConvertTo-Json -Depth 15
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.Headers['Access-Control-Allow-Origin'] = '*'
    $Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $Response.Headers['Access-Control-Allow-Headers'] = 'content-type'
    $Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    $Response.Headers['Pragma'] = 'no-cache'
    $Response.Headers['Expires'] = '0'
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Write-TextResponse {
    param($Response, [int]$StatusCode, [string]$ContentType, [string]$Body)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = $ContentType
    $Response.Headers['Access-Control-Allow-Origin'] = '*'
    $Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $Response.Headers['Access-Control-Allow-Headers'] = 'content-type'
    $Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    $Response.Headers['Pragma'] = 'no-cache'
    $Response.Headers['Expires'] = '0'
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Write-StreamHeaders {
    param($Response)
    $Response.StatusCode = 200
    $Response.ContentType = 'application/x-ndjson; charset=utf-8'
    $Response.SendChunked = $true
    $Response.KeepAlive = $true
    $Response.Headers['Access-Control-Allow-Origin'] = '*'
    $Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $Response.Headers['Access-Control-Allow-Headers'] = 'content-type'
    $Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    $Response.Headers['Pragma'] = 'no-cache'
    $Response.Headers['Expires'] = '0'
}

function Write-StreamEvent {
    param($Response, [hashtable]$Event)
    $line = ($Event | ConvertTo-Json -Compress) + "`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($line)
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Flush()
}

function Parse-Query {
    param([string]$Url)
    $result = @{}
    $parts = $Url.Split('?',2)
    if ($parts.Length -lt 2) { return $result }
    foreach ($pair in $parts[1].Split('&')) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $kv = $pair.Split('=',2)
        $k = [Uri]::UnescapeDataString($kv[0])
        $v = if ($kv.Length -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { '' }
        $result[$k] = $v
    }
    return $result
}

function ConvertTo-DotEnvLine {
    param([string]$Key, [string]$Value)
    $safeValue = if ($null -eq $Value) { '' } else { [string]$Value }
    $safeValue = $safeValue.Replace("`r", '').Replace("`n", '\n').Replace('"', '\"')
    return ('{0}="{1}"' -f $Key, $safeValue)
}

Start-Process $prefix | Out-Null
Write-Host "Web wizard running at $prefix" -ForegroundColor Green

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $path = $req.Url.AbsolutePath
        $method = $req.HttpMethod

        if ($method -eq 'OPTIONS') {
            Write-TextResponse -Response $res -StatusCode 204 -ContentType 'text/plain; charset=utf-8' -Body ''
            continue
        }

        if ($method -eq 'GET' -and $path -eq '/') {
            $indexPath = Join-Path $webRoot 'index.html'
            if (-not (Test-Path $indexPath)) {
                Write-TextResponse -Response $res -StatusCode 500 -ContentType 'text/plain; charset=utf-8' -Body 'Missing web/index.html'
                continue
            }
            $html = Get-Content -Path $indexPath -Raw
            Write-TextResponse -Response $res -StatusCode 200 -ContentType 'text/html; charset=utf-8' -Body $html
            continue
        }

        if ($method -eq 'GET' -and $path -eq '/api/health') {
            Write-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; status = 'running' }
            continue
        }

        if ($method -eq 'POST' -and $path -eq '/api/deploy') {
            $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
            $raw = $reader.ReadToEnd()
            $reader.Close()

            try {
                $body = $raw | ConvertFrom-Json
            } catch {
                Write-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'Invalid JSON payload.' }
                continue
            }

            if (-not $body.projectId -or -not $body.serviceAccountPath) {
                Write-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'projectId and serviceAccountPath are required.' }
                continue
            }

            $runId = [Guid]::NewGuid().ToString('N')
            $requestPath = Join-Path $stateDir "$runId.request.json"
            $statusPath = Join-Path $stateDir "$runId.status.json"
            $logPath = Join-Path $stateDir "$runId.log"
            $raw | Set-Content -Path $requestPath -Encoding UTF8
            "[$((Get-Date).ToString('u'))] Queued deployment run $runId" | Set-Content -Path $logPath -Encoding UTF8
            (@{ runId = $runId; state = 'queued'; message = 'Queued'; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json) | Set-Content -Path $statusPath -Encoding UTF8

            $workerPath = Join-Path $wizardRoot 'deploy-worker.ps1'
            try {
                $job = Start-Job -Name ("sap-deploy-" + $runId) -ScriptBlock {
                    param($runIdArg, $requestPathArg, $stateDirArg, $wizardRootArg)

                    & (Join-Path $wizardRootArg 'deploy-worker.ps1') `
                        -RunId $runIdArg `
                        -RequestPath $requestPathArg `
                        -StateDir $stateDirArg `
                        -WizardRoot $wizardRootArg
                } -ArgumentList $runId, $requestPath, $stateDir, $wizardRoot

                Add-Content -Path $logPath -Value "[$((Get-Date).ToString('u'))] Worker job started. JobId=$($job.Id) State=$($job.State)" -Encoding UTF8
                Add-Content -Path $logPath -Value "[$((Get-Date).ToString('u'))] Worker script: $workerPath" -Encoding UTF8
            }
            catch {
                $err = $_.Exception.Message
                Add-Content -Path $logPath -Value "[$((Get-Date).ToString('u'))] ERROR launching worker job: $err" -Encoding UTF8
                (@{ runId = $runId; state = 'failed'; message = $err; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json) | Set-Content -Path $statusPath -Encoding UTF8
                Write-JsonResponse -Response $res -StatusCode 500 -Body @{ error = $err }
                continue
            }

            Write-JsonResponse -Response $res -StatusCode 200 -Body @{ runId = $runId; state = 'queued' }
            continue
        }

        if ($method -eq 'POST' -and $path -eq '/api/run-stream') {
            Write-StreamHeaders -Response $res

            try {
                $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
                $raw = $reader.ReadToEnd()
                $reader.Close()

                try {
                    $body = $raw | ConvertFrom-Json
                }
                catch {
                    throw 'Invalid JSON payload.'
                }

                $projectId = [string]$body.projectId
                $firebaseConfigRaw = [string]$body.firebaseConfig

                if ([string]::IsNullOrWhiteSpace($projectId) -and -not [string]::IsNullOrWhiteSpace($firebaseConfigRaw)) {
                    try {
                        $firebaseCfg = ($firebaseConfigRaw | ConvertFrom-Json)
                        $projectId = [string]$firebaseCfg.projectId
                    }
                    catch {
                    }
                }

                if ([string]::IsNullOrWhiteSpace($projectId)) {
                    $firebaseConfigPath = Join-Path $wizardRoot 'firebase-config.json'
                    if (Test-Path $firebaseConfigPath) {
                        Write-StreamEvent -Response $res -Event @{ type = 'stdout'; chunk = "Using local firebase-config.json`n" }
                        try {
                            $firebaseConfigFileRaw = Get-Content -Path $firebaseConfigPath -Raw
                            $firebaseCfg = $firebaseConfigFileRaw | ConvertFrom-Json
                            $projectId = [string]$firebaseCfg.projectId
                        }
                        catch {
                            throw 'firebase-config.json exists but is invalid JSON.'
                        }
                    }
                }

                $serviceAccountPath = [string]$body.serviceAccountPath
                if ([string]::IsNullOrWhiteSpace($serviceAccountPath)) {
                    $serviceAccountPath = [string]$body.serviceAccount
                }

                if ([string]::IsNullOrWhiteSpace($serviceAccountPath)) {
                    $defaultSaPath = Join-Path $wizardRoot 'service-account.json'
                    if (Test-Path $defaultSaPath) {
                        $serviceAccountPath = $defaultSaPath
                        Write-StreamEvent -Response $res -Event @{ type = 'stdout'; chunk = "Using local service-account.json`n" }
                    }
                }

                $region = [string]$body.region
                if ([string]::IsNullOrWhiteSpace($region)) { $region = 'us-central1' }

                $memoryMb = 1024
                if ($body.memoryMb) { $memoryMb = [int]$body.memoryMb }

                $timeoutSeconds = 120
                if ($body.timeoutSeconds) { $timeoutSeconds = [int]$body.timeoutSeconds }

                $envMap = @{}
                if ($body.env) {
                    foreach ($property in $body.env.PSObject.Properties) {
                        $envMap[$property.Name] = [string]$property.Value
                    }
                }

                if ([string]::IsNullOrWhiteSpace([string]$envMap['STORAGE_BUCKET']) -and -not [string]::IsNullOrWhiteSpace([string]$envMap['FIREBASE_STORAGE_BUCKET'])) {
                    $envMap['STORAGE_BUCKET'] = [string]$envMap['FIREBASE_STORAGE_BUCKET']
                }

                $storageBackend = [string]$envMap['STORAGE_BACKEND']
                if ([string]::IsNullOrWhiteSpace($storageBackend)) {
                    $storageBackend = 'gcs'
                }
                $storageBackend = $storageBackend.Trim().ToLowerInvariant()

                if ($storageBackend -ne 'gcs' -and $storageBackend -ne 'drive') {
                    throw 'Invalid STORAGE_BACKEND. Allowed values: gcs, drive.'
                }

                $envMap['STORAGE_BACKEND'] = $storageBackend

                $replicateToDriveRaw = [string]$envMap['REPLICATE_TO_DRIVE']
                if ([string]::IsNullOrWhiteSpace($replicateToDriveRaw)) {
                    $replicateToDriveRaw = 'false'
                }
                $replicateToDrive = $replicateToDriveRaw.Trim().ToLowerInvariant() -eq 'true'
                $envMap['REPLICATE_TO_DRIVE'] = if ($replicateToDrive) { 'true' } else { 'false' }

                $replicateToDriveStrictRaw = [string]$envMap['REPLICATE_TO_DRIVE_STRICT']
                if ([string]::IsNullOrWhiteSpace($replicateToDriveStrictRaw)) {
                    $replicateToDriveStrictRaw = 'false'
                }
                $replicateToDriveStrict = $replicateToDriveStrictRaw.Trim().ToLowerInvariant() -eq 'true'
                $envMap['REPLICATE_TO_DRIVE_STRICT'] = if ($replicateToDriveStrict) { 'true' } else { 'false' }

                if ([string]::IsNullOrWhiteSpace($projectId)) {
                    throw 'Missing projectId. Provide projectId, firebaseConfig JSON with projectId, or place firebase-config.json in windows-wizard folder.'
                }
                if ([string]::IsNullOrWhiteSpace($serviceAccountPath)) {
                    throw 'Missing service account path. Provide serviceAccountPath/serviceAccount or place service-account.json in windows-wizard folder.'
                }
                if (-not (Test-Path $serviceAccountPath)) {
                    throw "Service account JSON not found: $serviceAccountPath"
                }

                if ($storageBackend -eq 'gcs' -and [string]::IsNullOrWhiteSpace([string]$envMap['STORAGE_BUCKET'])) {
                    $envMap['STORAGE_BUCKET'] = "$projectId.firebasestorage.app"
                }

                $requiredMissing = @()
                if ($storageBackend -eq 'gcs' -and [string]::IsNullOrWhiteSpace([string]$envMap['STORAGE_BUCKET'])) {
                    $requiredMissing += 'STORAGE_BUCKET'
                }

                $needsDriveSettings = ($storageBackend -eq 'drive') -or $replicateToDrive
                if ($needsDriveSettings) {
                    foreach ($requiredDriveKey in @('GOOGLE_DRIVE_FOLDER_ID')) {
                        if ([string]::IsNullOrWhiteSpace([string]$envMap[$requiredDriveKey])) {
                            $requiredMissing += $requiredDriveKey
                        }
                    }
                }

                if ($requiredMissing.Count -gt 0) {
                    throw ('Missing required .env values: ' + ($requiredMissing -join ', '))
                }

                $functionSourcePath = Join-Path $wizardRoot 'function-source'
                if (-not (Test-Path $functionSourcePath)) {
                    throw "Missing function-source folder: $functionSourcePath"
                }

                $firebaseCmd = Get-Command firebase -ErrorAction SilentlyContinue
                $useNpx = $false
                if (-not $firebaseCmd) {
                    $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
                    if ($npxCmd) {
                        $useNpx = $true
                    }
                    else {
                        throw 'Firebase CLI not found. Install firebase-tools or make firebase command available in PATH.'
                    }
                }

                $tmpDeployRoot = Join-Path $stateDir ("firebase-cli-deploy-" + [Guid]::NewGuid().ToString('N'))
                $tmpFunctionsDir = Join-Path $tmpDeployRoot 'functions'

                New-Item -ItemType Directory -Path $tmpFunctionsDir -Force | Out-Null
                Copy-Item -Path (Join-Path $functionSourcePath '*') -Destination $tmpFunctionsDir -Recurse -Force

                $envWriteOrder = @(
                    'STORAGE_BACKEND',
                    'STORAGE_BUCKET',
                    'REPLICATE_TO_DRIVE',
                    'REPLICATE_TO_DRIVE_STRICT',
                    'GOOGLE_DRIVE_FOLDER_ID',
                    'GOOGLE_DRIVE_CLIENT_ID',
                    'GOOGLE_DRIVE_CLIENT_SECRET',
                    'GOOGLE_DRIVE_REFRESH_TOKEN'
                )
                $envLines = @()
                foreach ($envKey in $envWriteOrder) {
                    if ($envMap.ContainsKey($envKey) -and -not [string]::IsNullOrWhiteSpace([string]$envMap[$envKey])) {
                        $envLines += (ConvertTo-DotEnvLine -Key $envKey -Value ([string]$envMap[$envKey]))
                    }
                }
                if ($envLines.Count -gt 0) {
                    $dotEnvPath = Join-Path $tmpFunctionsDir '.env'
                    ($envLines -join "`n") | Set-Content -Path $dotEnvPath -Encoding UTF8
                    Write-StreamEvent -Response $res -Event @{ type = 'stdout'; chunk = ('Generated .env with keys: ' + (($envLines | ForEach-Object { ($_ -split '=',2)[0] }) -join ', ') + "`n") }
                }

                $firebaseJson = @{
                    functions = @{
                        source = 'functions'
                    }
                }
                ($firebaseJson | ConvertTo-Json -Depth 10) | Set-Content -Path (Join-Path $tmpDeployRoot 'firebase.json') -Encoding UTF8

                $firebaserc = @{
                    projects = @{
                        default = $projectId
                    }
                }
                ($firebaserc | ConvertTo-Json -Depth 10) | Set-Content -Path (Join-Path $tmpDeployRoot '.firebaserc') -Encoding UTF8

                $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
                if (-not $npmCmd) {
                    throw 'npm not found in PATH. Install Node.js (includes npm) on this machine.'
                }

                $npmSource = [string]$npmCmd.Source
                $npmExt = [System.IO.Path]::GetExtension($npmSource).ToLowerInvariant()

                $npmInstallArgs = @('install', '--omit=dev', '--no-fund', '--no-audit', '--engine-strict=false')
                Write-StreamEvent -Response $res -Event @{ type = 'meta'; command = 'npm'; args = $npmInstallArgs }

                $npmStdoutPath = Join-Path $tmpDeployRoot 'npm.stdout.log'
                $npmStderrPath = Join-Path $tmpDeployRoot 'npm.stderr.log'

                $npmProc = $null
                $previousEngineStrict = $env:NPM_CONFIG_ENGINE_STRICT
                $env:NPM_CONFIG_ENGINE_STRICT = 'false'
                if ($npmExt -eq '.ps1') {
                    $npmCmdTwin = [System.IO.Path]::ChangeExtension($npmSource, '.cmd')
                    if (Test-Path $npmCmdTwin) {
                        $npmQuotedArgs = ($npmInstallArgs | ForEach-Object { '"' + (($_ -replace '"', '\\"')) + '"' }) -join ' '
                        $npmCmdLine = '""' + $npmCmdTwin + '" ' + $npmQuotedArgs + '"'
                        $npmProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $npmCmdLine) -WorkingDirectory $tmpFunctionsDir -NoNewWindow -PassThru -RedirectStandardOutput $npmStdoutPath -RedirectStandardError $npmStderrPath
                    }
                    else {
                        $npmPsArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $npmSource) + $npmInstallArgs
                        $npmProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $npmPsArgs -WorkingDirectory $tmpFunctionsDir -NoNewWindow -PassThru -RedirectStandardOutput $npmStdoutPath -RedirectStandardError $npmStderrPath
                    }
                }
                elseif ($npmExt -eq '.cmd' -or $npmExt -eq '.bat') {
                    $npmQuotedArgs = ($npmInstallArgs | ForEach-Object { '"' + (($_ -replace '"', '\\"')) + '"' }) -join ' '
                    $npmCmdLine = '""' + $npmSource + '" ' + $npmQuotedArgs + '"'
                    $npmProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $npmCmdLine) -WorkingDirectory $tmpFunctionsDir -NoNewWindow -PassThru -RedirectStandardOutput $npmStdoutPath -RedirectStandardError $npmStderrPath
                }
                elseif ($npmExt -eq '.exe') {
                    $npmProc = Start-Process -FilePath $npmSource -ArgumentList $npmInstallArgs -WorkingDirectory $tmpFunctionsDir -NoNewWindow -PassThru -RedirectStandardOutput $npmStdoutPath -RedirectStandardError $npmStderrPath
                }
                else {
                    $npmQuotedArgs = ($npmInstallArgs | ForEach-Object { '"' + (($_ -replace '"', '\\"')) + '"' }) -join ' '
                    $npmCmdLine = '"npm" ' + $npmQuotedArgs
                    $npmProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $npmCmdLine) -WorkingDirectory $tmpFunctionsDir -NoNewWindow -PassThru -RedirectStandardOutput $npmStdoutPath -RedirectStandardError $npmStderrPath
                }

                $npmProc.WaitForExit()
                $npmProc.Refresh()
                $npmExitCode = if ($null -eq $npmProc.ExitCode) { 1 } else { [int]$npmProc.ExitCode }

                if (Test-Path $npmStdoutPath) {
                    $npmOut = [string](Get-Content -Path $npmStdoutPath -Raw)
                    if (-not [string]::IsNullOrWhiteSpace($npmOut)) {
                        Write-StreamEvent -Response $res -Event @{ type = 'stdout'; chunk = $npmOut }
                    }
                }

                if (Test-Path $npmStderrPath) {
                    $npmErr = [string](Get-Content -Path $npmStderrPath -Raw)
                    if (-not [string]::IsNullOrWhiteSpace($npmErr)) {
                        Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = $npmErr }
                    }
                }

                $firebaseSdkPath = Join-Path $tmpFunctionsDir 'node_modules\firebase-functions\package.json'
                if ($npmExitCode -ne 0) {
                    if (Test-Path $firebaseSdkPath) {
                        Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = ("npm install returned exitCode=" + $npmExitCode + " but firebase-functions is present; continuing deployment.`n") }
                    }
                    else {
                        throw "npm install failed with exitCode=$npmExitCode"
                    }
                }
                $env:NPM_CONFIG_ENGINE_STRICT = $previousEngineStrict

                $deployArgs = @('deploy', '--only', 'functions', '--project', $projectId, '--non-interactive', '--force', '--debug')

                $metaCommand = if ($useNpx) { 'npx firebase-tools' } else { 'firebase' }
                Write-StreamEvent -Response $res -Event @{ type = 'meta'; command = $metaCommand; args = $deployArgs }

                $previousCredentials = $env:GOOGLE_APPLICATION_CREDENTIALS
                $env:GOOGLE_APPLICATION_CREDENTIALS = $serviceAccountPath

                $exitCode = 1
                $firebaseOutText = ''
                $firebaseErrText = ''
                try {
                    Push-Location $tmpDeployRoot
                    $stdoutPath = Join-Path $tmpDeployRoot 'firebase.stdout.log'
                    $stderrPath = Join-Path $tmpDeployRoot 'firebase.stderr.log'

                    $quotedArgs = ($deployArgs | ForEach-Object { '"' + (($_ -replace '"', '\\"')) + '"' }) -join ' '
                    $proc = $null

                    if ($useNpx) {
                        $cmdLine = '"npx firebase-tools ' + $quotedArgs + '"'
                        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $cmdLine) -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                    }
                    else {
                        $firebaseSource = if ($firebaseCmd -and $firebaseCmd.Source) { [string]$firebaseCmd.Source } else { 'firebase' }
                        $firebaseExt = [System.IO.Path]::GetExtension($firebaseSource).ToLowerInvariant()

                        if ($firebaseExt -eq '.ps1') {
                            $firebaseCmdTwin = [System.IO.Path]::ChangeExtension($firebaseSource, '.cmd')
                            if (Test-Path $firebaseCmdTwin) {
                                $cmdLine = '""' + $firebaseCmdTwin + '" ' + $quotedArgs + '"'
                                $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $cmdLine) -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                            }
                            else {
                                $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $firebaseSource) + $deployArgs
                                $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                            }
                        }
                        elseif ($firebaseExt -eq '.cmd' -or $firebaseExt -eq '.bat') {
                            $cmdLine = '""' + $firebaseSource + '" ' + $quotedArgs + '"'
                            $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $cmdLine) -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                        }
                        elseif ($firebaseExt -eq '.exe') {
                            $proc = Start-Process -FilePath $firebaseSource -ArgumentList $deployArgs -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                        }
                        else {
                            $cmdLine = '"firebase ' + $quotedArgs + '"'
                            $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $cmdLine) -WorkingDirectory $tmpDeployRoot -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
                        }
                    }

                    $proc.WaitForExit()
                    $proc.Refresh()
                    if ($null -eq $proc.ExitCode) {
                        $exitCode = 1
                    }
                    else {
                        $exitCode = [int]$proc.ExitCode
                    }

                    if (Test-Path $stdoutPath) {
                        $firebaseOutText = [string](Get-Content -Path $stdoutPath -Raw)
                        if (-not [string]::IsNullOrWhiteSpace($firebaseOutText)) {
                            Write-StreamEvent -Response $res -Event @{ type = 'stdout'; chunk = $firebaseOutText }
                        }
                    }

                    if (Test-Path $stderrPath) {
                        $firebaseErrText = [string](Get-Content -Path $stderrPath -Raw)
                        if (-not [string]::IsNullOrWhiteSpace($firebaseErrText)) {
                            Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = $firebaseErrText }
                        }
                    }
                }
                finally {
                    Pop-Location
                    $env:GOOGLE_APPLICATION_CREDENTIALS = $previousCredentials
                    if (Test-Path $tmpDeployRoot) {
                        Remove-Item -Path $tmpDeployRoot -Recurse -Force -ErrorAction SilentlyContinue
                    }
                }

                $successMarkers = @(
                    'Deploy complete!',
                    'Successful update operation',
                    'Successful create operation',
                    'Functions Deployed'
                )
                $hasSuccessMarker = $false
                foreach ($marker in $successMarkers) {
                    if ($firebaseOutText -like "*$marker*" -or $firebaseErrText -like "*$marker*") {
                        $hasSuccessMarker = $true
                        break
                    }
                }

                if ($exitCode -ne 0 -and $hasSuccessMarker) {
                    Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = ("firebase returned exitCode=" + $exitCode + " but success markers were found in output; treating as success.`n") }
                    $exitCode = 0
                }

                if ($exitCode -eq 0) {
                    Write-StreamEvent -Response $res -Event @{ type = 'done'; ok = $true; exitCode = 0 }
                }
                else {
                    Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = ("firebase deploy failed with exitCode=" + $exitCode + "`n") }
                    Write-StreamEvent -Response $res -Event @{ type = 'done'; ok = $false; exitCode = $exitCode }
                }
            }
            catch {
                $errMsg = $_.Exception.Message
                Write-StreamEvent -Response $res -Event @{ type = 'stderr'; chunk = ($errMsg + "`n") }
                Write-StreamEvent -Response $res -Event @{ type = 'done'; ok = $false; exitCode = 1 }
            }
            finally {
                $res.Close()
            }

            continue
        }

        if ($method -eq 'GET' -and $path -eq '/api/logs') {
            $query = Parse-Query -Url $req.RawUrl
            $runId = [string]$query['runId']
            if ([string]::IsNullOrWhiteSpace($runId)) {
                Write-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'runId is required.' }
                continue
            }

            $statusPath = Join-Path $stateDir "$runId.status.json"
            $logPath = Join-Path $stateDir "$runId.log"
            if (-not (Test-Path $statusPath)) {
                Write-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'runId not found.' }
                continue
            }

            $statusObj = Get-Content -Path $statusPath -Raw | ConvertFrom-Json
            $logText = if (Test-Path $logPath) { Get-Content -Path $logPath -Raw } else { '' }

            if ([string]::IsNullOrWhiteSpace($logText)) {
                $logText = "[$((Get-Date).ToString('u'))] No log lines yet. State=$($statusObj.state). Message=$($statusObj.message)"
            }

            Write-JsonResponse -Response $res -StatusCode 200 -Body @{
                runId = $runId
                state = $statusObj.state
                message = $statusObj.message
                updatedAt = $statusObj.updatedAt
                result = $statusObj.result
                log = $logText
            }
            continue
        }

        Write-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'Not found' }
    }
}
finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
