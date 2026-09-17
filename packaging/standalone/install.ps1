$ErrorActionPreference = 'Stop'
try {
    if ($env:SDLC_NODE) {
        if (-not [IO.Path]::IsPathRooted($env:SDLC_NODE)) {
            throw 'SDLC_NODE must be an absolute Node.js executable path'
        }
        $node = $env:SDLC_NODE
    } else {
        $selected = Get-Command node -ErrorAction Stop
        if ($selected.CommandType -ne 'Application') {
            throw 'Node.js is shadowed by a non-application command'
        }
        $node = $selected.Source
    }
    if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or [IO.Path]::GetExtension($node) -ne '.exe') {
        throw 'Node.js must be an executable application'
    }
    $resolved = & $node -e 'if(Number(process.versions.node.split(String.fromCharCode(46))[0])<22)process.exit(22);process.stdout.write(process.execPath)'
    if ($LASTEXITCODE -ne 0 -or -not $resolved) { throw 'AI SDLC requires Node.js 22+' }
    $node = [string]$resolved
    & $node (Join-Path $PSScriptRoot 'package/packaging/standalone/runtime.mjs') install-channel --root $PSScriptRoot --node $node -- @args
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
