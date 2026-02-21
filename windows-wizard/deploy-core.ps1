$ErrorActionPreference = 'Stop'

function New-DeployResult {
    param(
        [bool]$Success,
        [string]$Message,
        [hashtable]$Data = @{}
    )

    return @{
        success = $Success
        message = $Message
        data    = $Data
    }
}

function To-Base64Url {
    param([byte[]]$Bytes)
    $base64 = [Convert]::ToBase64String($Bytes)
    return $base64.TrimEnd('=') -replace '\+', '-' -replace '/', '_'
}

function New-JwtAssertion {
    param(
        [string]$ClientEmail,
        [string]$PrivateKeyPem,
        [string]$Scope
    )

    $headerJson = '{"alg":"RS256","typ":"JWT"}'
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $payloadObject = @{
        iss   = $ClientEmail
        scope = $Scope
        aud   = 'https://oauth2.googleapis.com/token'
        iat   = $now
        exp   = $now + 3600
    }
    $payloadJson = $payloadObject | ConvertTo-Json -Compress

    $headerEncoded = To-Base64Url ([Text.Encoding]::UTF8.GetBytes($headerJson))
    $payloadEncoded = To-Base64Url ([Text.Encoding]::UTF8.GetBytes($payloadJson))
    $unsigned = "$headerEncoded.$payloadEncoded"

    $pem = $PrivateKeyPem -replace '-----BEGIN PRIVATE KEY-----', '' -replace '-----END PRIVATE KEY-----', '' -replace "`r", '' -replace "`n", ''
    $privateKeyBytes = [Convert]::FromBase64String($pem)

    $signatureBytes = $null

    try {
        $rsa = [System.Security.Cryptography.RSA]::Create()
        [void]$rsa.ImportPkcs8PrivateKey($privateKeyBytes, [ref]0)
        $signatureBytes = $rsa.SignData(
            [Text.Encoding]::UTF8.GetBytes($unsigned),
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
        )
    }
    catch {
        try {
            $cngKey = [System.Security.Cryptography.CngKey]::Import(
                $privateKeyBytes,
                [System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob
            )
            $rsaCng = [System.Security.Cryptography.RSACng]::new($cngKey)
            $signatureBytes = $rsaCng.SignData(
                [Text.Encoding]::UTF8.GetBytes($unsigned),
                [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
            )
        }
        catch {
            throw "No se pudo importar la llave privada RSA (PKCS8). Verifica que el service-account JSON sea válido y tenga private_key en formato PKCS8. Error: $($_.Exception.Message)"
        }
    }

    if ($null -eq $signatureBytes -or $signatureBytes.Length -eq 0) {
        throw 'No se pudo firmar el JWT con la llave privada.'
    }

    $signatureEncoded = To-Base64Url $signatureBytes

    return "$unsigned.$signatureEncoded"
}

function Get-AccessToken {
    param(
        [string]$ClientEmail,
        [string]$PrivateKeyPem
    )

    $scope = 'https://www.googleapis.com/auth/cloud-platform'
    $assertion = New-JwtAssertion -ClientEmail $ClientEmail -PrivateKeyPem $PrivateKeyPem -Scope $scope

    $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
        grant_type = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
        assertion  = $assertion
    }

    return $tokenResponse.access_token
}

function Invoke-GoogleApi {
    param(
        [string]$Method,
        [string]$Uri,
        [string]$Token,
        [object]$Body = $null,
        [string]$ContentType = 'application/json'
    )

    $headers = @{ Authorization = "Bearer $Token" }

    if ($null -eq $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
    }

    if ($ContentType -eq 'application/json') {
        $json = $Body | ConvertTo-Json -Depth 30 -Compress
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType $ContentType -Body $json
    }

    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType $ContentType -Body $Body
}

function Get-WebExceptionDetails {
    param([object]$Exception)

    $message = $Exception.Message
    $statusCodeText = ''
    $responseBody = ''

    $webEx = $Exception
    if ($webEx -and $webEx.PSObject -and $webEx.PSObject.Properties.Name -contains 'Exception') {
        $webEx = $webEx.Exception
    }

    try {
        if ($webEx.Response) {
            try {
                if ($webEx.Response.StatusCode) {
                    $statusCodeText = [int]$webEx.Response.StatusCode
                }
            }
            catch {
            }

            try {
                $stream = $webEx.Response.GetResponseStream()
                if ($stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    $responseBody = $reader.ReadToEnd()
                    $reader.Close()
                }
            }
            catch {
            }
        }
    }
    catch {
    }

    if (-not [string]::IsNullOrWhiteSpace($responseBody)) {
        if ($responseBody.Length -gt 4000) {
            $responseBody = $responseBody.Substring(0, 4000) + '...'
        }
        return "$message | HTTP=$statusCodeText | Response=$responseBody"
    }

    if (-not [string]::IsNullOrWhiteSpace($statusCodeText)) {
        return "$message | HTTP=$statusCodeText"
    }

    return $message
}

function Upload-SignedUrlFile {
    param(
        [string]$UploadUrl,
        [string]$FilePath,
        [string]$ContentType = 'application/zip'
    )

    if (-not (Test-Path $FilePath)) {
        throw "Upload file not found: $FilePath"
    }

    $fileInfo = Get-Item -Path $FilePath
    $request = [System.Net.HttpWebRequest]::Create($UploadUrl)
    $request.Method = 'PUT'
    $request.ContentType = $ContentType
    $request.AllowWriteStreamBuffering = $false
    $request.SendChunked = $false
    $request.ContentLength = $fileInfo.Length

    try {
        $reqStream = $request.GetRequestStream()
        $fileStream = [System.IO.File]::OpenRead($FilePath)
        try {
            $buffer = New-Object byte[] 81920
            while (($read = $fileStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $reqStream.Write($buffer, 0, $read)
            }
        }
        finally {
            $fileStream.Close()
            $reqStream.Close()
        }

        $response = $request.GetResponse()
        $response.Close()
    }
    catch {
        $uploadErr = Get-WebExceptionDetails -Exception $_
        throw "Source bundle upload failed: $uploadErr"
    }
}

function Wait-Operation {
    param(
        [string]$OperationName,
        [string]$Token,
        [int]$TimeoutSeconds = 1200,
        [string]$OperationApiBase = 'https://cloudfunctions.googleapis.com/v1',
        [scriptblock]$Log = $null
    )

    $start = Get-Date
    while ($true) {
        $uri = "$OperationApiBase/$OperationName"
        $op = Invoke-GoogleApi -Method Get -Uri $uri -Token $Token

        if ($op.done -eq $true) {
            if ($op.error) {
                $err = $op.error | ConvertTo-Json -Depth 10
                throw "Operation failed: $err"
            }
            return $op
        }

        if ($Log) { & $Log "Waiting operation: $OperationName" }

        if (((Get-Date) - $start).TotalSeconds -ge $TimeoutSeconds) {
            throw "Operation timeout after $TimeoutSeconds seconds: $OperationName"
        }

        Start-Sleep -Seconds 5
    }
}

function Invoke-FunctionDeployment {
    param(
        [string]$ProjectId,
        [string]$Region,
        [string]$ServiceAccountPath,
        [int]$MemoryMb,
        [int]$TimeoutSeconds,
        [string]$FunctionSourcePath,
        [string]$FunctionName = 'api',
        [scriptblock]$Log = $null
    )

    if ([string]::IsNullOrWhiteSpace($ProjectId)) { throw 'Project ID is required.' }
    if ([string]::IsNullOrWhiteSpace($Region)) { $Region = 'us-central1' }
    if (-not (Test-Path $ServiceAccountPath)) { throw "Service account JSON not found: $ServiceAccountPath" }

    $distPath = Join-Path $FunctionSourcePath 'dist'
    $packagePath = Join-Path $FunctionSourcePath 'package.json'
    if (-not (Test-Path $distPath)) { throw "Missing function source dist folder: $distPath" }
    if (-not (Test-Path $packagePath)) { throw "Missing function source package.json: $packagePath" }

    if (-not $MemoryMb -or $MemoryMb -lt 128) { $MemoryMb = 1024 }
    if (-not $TimeoutSeconds -or $TimeoutSeconds -lt 30) { $TimeoutSeconds = 120 }

    if ($Log) { & $Log 'Loading service account' }
    $saJson = Get-Content -Path $ServiceAccountPath -Raw | ConvertFrom-Json
    if (-not $saJson.client_email -or -not $saJson.private_key) {
        throw 'Invalid service account JSON: missing client_email/private_key.'
    }

    if ($Log) { & $Log 'Getting OAuth token' }
    $token = Get-AccessToken -ClientEmail $saJson.client_email -PrivateKeyPem $saJson.private_key

    if ($Log) { & $Log 'Resolving project number' }
    $projectInfo = Invoke-GoogleApi -Method Get -Uri "https://cloudresourcemanager.googleapis.com/v1/projects/$ProjectId" -Token $token
    $projectNumber = $projectInfo.projectNumber
    if (-not $projectNumber) { throw 'Could not resolve project number.' }

    if ($Log) { & $Log 'Enabling required APIs' }
    $servicesToEnable = @(
        'cloudfunctions.googleapis.com',
        'cloudbuild.googleapis.com',
        'artifactregistry.googleapis.com',
        'run.googleapis.com'
    )
    $enableOp = Invoke-GoogleApi -Method Post -Uri "https://serviceusage.googleapis.com/v1/projects/$projectNumber/services:batchEnable" -Token $token -Body @{ serviceIds = $servicesToEnable }
    if ($enableOp.name) {
        Wait-Operation -OperationName $enableOp.name -Token $token -TimeoutSeconds 1200 -OperationApiBase 'https://serviceusage.googleapis.com/v1' -Log $Log | Out-Null
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("sap-content-deploy-" + [Guid]::NewGuid().ToString('N'))
    $zipPath = Join-Path $tempRoot 'source.zip'

    try {
        if ($Log) { & $Log 'Preparing source zip' }
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        Compress-Archive -Path (Join-Path $FunctionSourcePath '*') -DestinationPath $zipPath -Force

        if ($Log) { & $Log 'Requesting upload URL' }
        $uploadInfo = Invoke-GoogleApi -Method Post -Uri "https://cloudfunctions.googleapis.com/v1/projects/$ProjectId/locations/$Region/functions:generateUploadUrl" -Token $token -Body @{}
        if (-not $uploadInfo.uploadUrl) { throw 'Could not generate upload URL.' }

        if ($Log) { & $Log 'Uploading source bundle' }
        Upload-SignedUrlFile -UploadUrl $uploadInfo.uploadUrl -FilePath $zipPath -ContentType 'application/zip'

        $fullFunctionName = "projects/$ProjectId/locations/$Region/functions/$FunctionName"
        $functionBody = @{
            name = $fullFunctionName
            description = 'SAP Content Server API'
            entryPoint = $FunctionName
            runtime = 'nodejs22'
            timeout = "${TimeoutSeconds}s"
            availableMemoryMb = $MemoryMb
            sourceUploadUrl = $uploadInfo.uploadUrl
            httpsTrigger = @{}
        }

        if ($Log) { & $Log 'Creating or updating function' }
        $functionExists = $false
        try {
            $existing = Invoke-GoogleApi -Method Get -Uri "https://cloudfunctions.googleapis.com/v1/$fullFunctionName" -Token $token
            if ($existing.name) { $functionExists = $true }
        } catch {
            $functionExists = $false
        }

        if (-not $functionExists) {
            $createOp = Invoke-GoogleApi -Method Post -Uri "https://cloudfunctions.googleapis.com/v1/projects/$ProjectId/locations/$Region/functions" -Token $token -Body $functionBody
            Wait-Operation -OperationName $createOp.name -Token $token -TimeoutSeconds 1800 -Log $Log | Out-Null
        } else {
            $updateMask = 'description,entryPoint,runtime,timeout,availableMemoryMb,sourceUploadUrl'
            $patchOp = Invoke-GoogleApi -Method Patch -Uri "https://cloudfunctions.googleapis.com/v1/$fullFunctionName`?updateMask=$updateMask" -Token $token -Body $functionBody
            Wait-Operation -OperationName $patchOp.name -Token $token -TimeoutSeconds 1800 -Log $Log | Out-Null
        }

        if ($Log) { & $Log 'Setting public invoker policy' }
        $policyBody = @{
            policy = @{
                bindings = @(
                    @{
                        role = 'roles/cloudfunctions.invoker'
                        members = @('allUsers')
                    }
                )
            }
        }

        try {
            Invoke-GoogleApi -Method Post -Uri "https://cloudfunctions.googleapis.com/v1/$fullFunctionName:setIamPolicy" -Token $token -Body $policyBody | Out-Null
        } catch {
            if ($Log) { & $Log 'Warning: could not set public invoker policy automatically.' }
        }

        $finalFn = Invoke-GoogleApi -Method Get -Uri "https://cloudfunctions.googleapis.com/v1/$fullFunctionName" -Token $token
        $url = $finalFn.httpsTrigger.url

        if ($Log) { & $Log "Deployment complete: $url" }

        return New-DeployResult -Success $true -Message 'Deployment completed successfully.' -Data @{
            projectId = $ProjectId
            region = $Region
            functionName = $FunctionName
            url = $url
            healthUrl = "$url/health"
            memoryMb = $MemoryMb
            timeoutSeconds = $TimeoutSeconds
        }
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
