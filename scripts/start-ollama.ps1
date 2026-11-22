$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$privateDir = Join-Path $projectRoot '.private'
$portableExecutable = Join-Path $privateDir 'ollama/ollama.exe'
$installedCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $portableExecutable) {
    $ollamaExecutable = $portableExecutable
} elseif ($installedCommand) {
    $ollamaExecutable = $installedCommand.Source
} else {
    throw 'Install Ollama from https://ollama.com/download/windows first.'
}

try {
    $version = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2
    Write-Output "Ollama $($version.version) is already running."
    exit 0
} catch {}

New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
$env:OLLAMA_HOST = '127.0.0.1:11434'
if ($ollamaExecutable -eq $portableExecutable) {
    $env:OLLAMA_MODELS = Join-Path $privateDir 'models'
}
$serverProcess = Start-Process -FilePath $ollamaExecutable -ArgumentList 'serve' -WindowStyle Hidden -PassThru -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $privateDir 'ollama.stdout.log') -RedirectStandardError (Join-Path $privateDir 'ollama.stderr.log')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $version = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 1
        Write-Output "Started Ollama $($version.version) on http://127.0.0.1:11434 (PID $($serverProcess.Id))."
        Write-Output "Pull the model: & '$ollamaExecutable' pull qwen3:0.6b"
        exit 0
    } catch {}
}
throw "Ollama did not become ready. Inspect $privateDir/ollama.stderr.log."
