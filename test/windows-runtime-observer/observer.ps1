param(
    [Parameter(Mandatory=$true)][string]$Directory,
    [Parameter(Mandatory=$true)][string]$Nonce,
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [Parameter(Mandatory=$true)][long]$OwnerCreatedBeforeMs,
    [Parameter(Mandatory=$true)][ValidateSet('taskkill','node','node24')][string]$ExpectedImage
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$epochTicks = 621355968000000000L
$utf8 = New-Object System.Text.UTF8Encoding($false)
$clock = [Diagnostics.Stopwatch]::StartNew()
$owner = $null
$primary = $null

function UtcMs {
    return [long]([Math]::Floor(([DateTime]::UtcNow.Ticks - $epochTicks) / 10000.0))
}

function Identity {
    return [ordered]@{
        status='unverified'; reason='uncaptured'; image=$null; handlePinned=$false
        creationTicks=$null; capturedUtcMs=$null; sampleAttempts=0
        samplesTruncated=$false; lateSampleDropped=$false; samples=@()
    }
}

$result = [ordered]@{
    schema=2; reason='uncaptured'; ownerHandlePinned=$false; ownerWaitStatus=$null
    compilerSandboxed=$false; tickEpoch='1601-01-01T00:00:00Z'; tickUnit='100ns'
    cpuTickUnit='100ns'; threadWaits='unavailable'; deadlineMs=1000
    perTargetSampleLimit=8; targetLimit=1; recordTruncated=$false; durationMs=0
    target=(Identity); rootObservation='unavailable'
}

function Publish([string]$Kind, $Value) {
    $path = [IO.Path]::Combine($Directory, "$Nonce.$Kind.json")
    $json = ConvertTo-Json -InputObject $Value -Depth 10 -Compress
    [IO.File]::WriteAllText("$path.pending", $json, $utf8)
    [IO.File]::Move("$path.pending", $path)
}

function SourceHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Startup([string]$Kind, [string]$Phase, [string]$Reason,
    [double]$ElapsedMs = -1, [long]$Utc = -1) {
    if ($ElapsedMs -lt 0) { $ElapsedMs = $clock.Elapsed.TotalMilliseconds }
    if ($Utc -lt 0) { $Utc = UtcMs }
    Publish "startup-$Kind" ([ordered]@{
        schema=1; phase=$Phase; reason=$Reason
        elapsedMs=[Math]::Round($ElapsedMs, 3); utcMs=$Utc
        observerSha256=$observerSha256; bridgeSha256=$bridgeSha256
    })
}

function Released {
    return [IO.File]::Exists([IO.Path]::Combine($Directory, "$Nonce.release.json"))
}

function Binding([int]$ProcessId, [long]$Bound, [string[]]$Images, $Record) {
    $process = $null
    $handle = [IntPtr]::Zero
    try {
        # This is the only PID-based lookup for this supplied identity.
        $process = [Diagnostics.Process]::GetProcessById($ProcessId)
        $handle = $process.Handle
        $sample = [ObserverNative]::Read($handle)
        if ($sample.NativeExited -ne $false -or $null -eq $sample.CreationTicks) {
            $Record.reason = 'captureUnavailable'
        } elseif (-not [ObserverNative]::CreatedBefore($sample, $Bound)) {
            $Record.reason = 'creationAmbiguous'
        } else {
            $image = [ObserverNative]::ClosedImage($handle)
            if ($image -eq 'unavailable') {
                $Record.reason = 'imageUnavailable'
            } elseif ($image -notin $Images) {
                $Record.reason = 'imageMismatch'
            } elseif ([ObserverNative]::WaitForSingleObject($handle, 0) -ne 258) {
                $Record.reason = 'captureUnavailable'
            } else {
                $Record.status = 'verified'
                $Record.reason = 'bound'
                $Record.image = $image
                $Record.handlePinned = $true
                $Record.creationTicks = $sample.CreationTicks
                $Record.capturedUtcMs = UtcMs
                return [pscustomobject]@{ Process=$process; Handle=$handle; Record=$Record }
            }
        }
    } catch { $Record.reason = 'captureUnavailable' }
    if ($null -ne $process) { $process.Dispose() }
    return $null
}

function OwnerAlive {
    $wait = [ObserverNative]::WaitForSingleObject($owner.Handle, 0)
    if ($wait -eq 0 -or $wait -eq 258) { $result.ownerWaitStatus = $wait }
    else { $result.ownerWaitStatus = $null }
    if ($wait -eq 258) { return $true }
    if ($wait -eq 0) { $result.reason = 'ownerExited' }
    else { $result.reason = 'ownerUnknown' }
    return $false
}

function Sample($Binding, [double]$Deadline, [long]$Bound, [bool]$Cpu) {
    $record = $Binding.Record
    $record.sampleAttempts++
    $from = UtcMs
    $native = [ObserverNative]::Read($Binding.Handle)
    $sample = [ordered]@{
        fromUtcMs=$from; utcMs=(UtcMs)
        elapsedMs=[Math]::Round(1000 - ($Deadline - $clock.Elapsed.TotalMilliseconds), 3)
        waitStatus=$null; nativeExited=$native.NativeExited
        exitTicks=$native.ExitTicks; exitCode=$native.ExitCode
    }
    if ($native.WaitStatus -eq 0 -or $native.WaitStatus -eq 258) {
        $sample.waitStatus = $native.WaitStatus
    }
    if ($Cpu) {
        $sample.kernelTicks=$native.KernelTicks
        $sample.userTicks=$native.UserTicks
        $sample.cpuTicks=$native.CpuTicks
    }
    if ($sample.elapsedMs -ge 1000 -or $sample.utcMs -ge ($Bound + 1000)) {
        $record.lateSampleDropped = $true
        return
    }
    # Keep four first/four latest observations, with an explicit dropped flag.
    if ($record.samples.Count -eq 8) {
        $record.samples = @($record.samples[0..3]) + @($record.samples[5..7])
        $record.samplesTruncated = $true
    }
    $record.samples += $sample
    if ($native.NativeExited -eq $true) { $record.reason = 'exited' }
}

try {
    if ($Nonce -notmatch '^[a-f0-9]{32}$') { return }
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
        $result.reason = 'unsupportedRuntime'
        return
    }
    $startupPhase = 'compilerScope'
    try {
        $compiler = [IO.Path]::GetFullPath([IO.Path]::Combine($Directory, 'compiler'))
        $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if ($temp -cne $compiler -or $env:TEMP.TrimEnd('\') -cne $compiler -or
            $env:TMP.TrimEnd('\') -cne $compiler) { throw 'compiler-scope' }
        $assembly = [IO.Path]::Combine($compiler, "$Nonce.bridge.dll")
        $sourceBytes = [IO.File]::ReadAllBytes([IO.Path]::Combine($PSScriptRoot, 'bridge.cs'))
        $source = $utf8.GetString($sourceBytes)
        $bridgeSha256 = SourceHash $sourceBytes
        $observerSha256 = SourceHash ([IO.File]::ReadAllBytes($PSCommandPath))
        try { Startup 'entered' 'entered' 'none' } catch {}
        $startupPhase = 'compile'
        try { Startup 'compiling' 'compiling' 'none' } catch {}
        Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $assembly -ErrorAction Stop
        $compilerReturnedElapsedMs = $clock.Elapsed.TotalMilliseconds
        $compilerReturnedUtcMs = UtcMs
        # CodeDom has returned from its synchronous compiler invocation. Nothing
        # after this marker launches another compiler; loading the DLL is separate.
        $startupPhase = 'settlementPublish'
        Publish 'compiler-settled' ([ordered]@{
            schema=1; compilerSettled=$true
            observerSha256=$observerSha256; bridgeSha256=$bridgeSha256
        })
        try { Startup 'compiled' 'compiled' 'none' $compilerReturnedElapsedMs $compilerReturnedUtcMs } catch {}
        $startupPhase = 'assemblyLoad'
        Add-Type -Path $assembly -ErrorAction Stop
        $startupPhase = 'precisionProbe'
        $precisionProbe = New-Object ObserverNativeSample
        $precisionProbe.CreationTicks = '116444736001234567'
        if ([ObserverNative]::CreatedBefore($precisionProbe, 123) -or
            -not [ObserverNative]::CreatedBefore($precisionProbe, 124)) { throw 'tick-bound' }
        $result.compilerSandboxed = $true
    } catch {
        $result.reason = 'bridgeUnavailable'
        try { Startup 'failed' $startupPhase 'bridgeUnavailable' } catch {}
        return
    }
    $ownerRecord = Identity
    $owner = Binding $OwnerPid $OwnerCreatedBeforeMs @('node', 'node24') $ownerRecord
    if ($null -eq $owner) {
        $result.reason = 'ownerUnverified'
        try { Startup 'failed' 'ownerBinding' $ownerRecord.reason } catch {}
        return
    }
    $result.ownerHandlePinned = $true
    if (-not (OwnerAlive)) {
        try { Startup 'failed' 'ownerWait' $result.reason } catch {}
        return
    }
    $startupPhase = 'readyPublish'
    Publish 'ready' ([ordered]@{schema=2; ownerHandlePinned=$true; compilerSandboxed=$true})
    $requestPath = [IO.Path]::Combine($Directory, "$Nonce.request.json")
    $readyAt = $clock.Elapsed.TotalMilliseconds
    while (-not [IO.File]::Exists($requestPath)) {
        if (-not (OwnerAlive)) { return }
        if (Released) { $result.reason = 'released'; return }
        if (($clock.Elapsed.TotalMilliseconds - $readyAt) -ge 15000) { return }
        [Threading.Thread]::Sleep(10)
    }
    if (-not (OwnerAlive)) { return }
    try {
        if ((New-Object IO.FileInfo($requestPath)).Length -gt 256) { throw 'request-size' }
        $request = [IO.File]::ReadAllText($requestPath, $utf8) | ConvertFrom-Json
        $keys = @($request.PSObject.Properties.Name | Sort-Object)
        if (($keys -join ',') -ne 'createdBeforeMs,pid' -or
            $request.pid -isnot [int] -or $request.pid -le 0 -or
            $request.pid -eq $OwnerPid -or
            ($request.createdBeforeMs -isnot [long] -and $request.createdBeforeMs -isnot [int]) -or
            $request.createdBeforeMs -le 0) { throw 'request-shape' }
        $bound = [long]$request.createdBeforeMs
    } catch { $result.reason = 'invalidRequest'; return }
    $age = (UtcMs) - $bound
    if ($age -lt 0 -or $age -ge 1000) {
        $result.reason = 'deadlineBeforeCapture'
        $result.target.reason = 'deadlineBeforeCapture'
        return
    }
    $deadline = $clock.Elapsed.TotalMilliseconds + (1000 - $age)
    $primary = Binding ([int]$request.pid) $bound @($ExpectedImage) $result.target
    if ($null -ne $primary -and
        ($clock.Elapsed.TotalMilliseconds -ge $deadline -or (UtcMs) -ge ($bound + 1000))) {
        $primary.Process.Dispose()
        $primary = $null
        $result.target = Identity
        $result.target.reason = 'deadlineBeforeCapture'
    }
    Publish 'captured' ([ordered]@{schema=2; targetStatus=$result.target.status})
    if ($null -eq $primary) { $result.reason = 'captureUnavailable'; return }
    $result.reason = 'deadline'
    $attempts = 0
    while ($clock.Elapsed.TotalMilliseconds -lt $deadline -and $attempts -lt 32) {
        if (-not (OwnerAlive)) { break }
        if (Released) { $result.reason = 'released'; break }
        $attempts++
        Sample $primary $deadline $bound $true
        if ($result.target.reason -eq 'exited') { $result.reason = 'targetExited'; break }
        $remaining = $deadline - $clock.Elapsed.TotalMilliseconds
        if ($remaining -gt 0) { [Threading.Thread]::Sleep([int][Math]::Min(50, $remaining)) }
    }
} catch { $result.reason = 'collectorFault' }
finally {
    foreach ($binding in @($primary, $owner)) {
        if ($null -ne $binding) { $binding.Process.Dispose() }
    }
    $result.durationMs = [Math]::Round($clock.Elapsed.TotalMilliseconds, 3)
    try {
        $json = ConvertTo-Json -InputObject $result -Depth 10 -Compress
        while ($utf8.GetByteCount($json) -gt 8192) {
            $changed = $false
            foreach ($record in @($result.target)) {
                if ($null -ne $record -and $record.samples.Count -gt 0) {
                    $record.samples = @($record.samples | Select-Object -Skip 1)
                    $changed = $true
                }
            }
            $result.recordTruncated = $true
            if (-not $changed) { throw 'record-size' }
            $json = ConvertTo-Json -InputObject $result -Depth 10 -Compress
        }
        Publish 'result' $result
    } catch {}
}
