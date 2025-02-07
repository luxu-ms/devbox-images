# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

$ProgressPreference = 'SilentlyContinue'	# hide any progress output

$vsInstallerName = "vs_code.exe"
$vsInstallerPath = Join-Path -Path $env:TEMP -ChildPath $vsInstallerName

Write-Host "[${env:username}] Downloading VSCode ..."
(new-object net.webclient).DownloadFile('https://code.visualstudio.com/sha/download?build=stable&os=win32-x64', $vsInstallerPath)

# https://github.com/Microsoft/vscode/blob/main/build/win32/code.iss#L77-L83

Write-Host "[${env:username}] Installing VSCode ..."
$process = Start-Process -FilePath $vsInstallerPath -ArgumentList `
	"/verysilent", `
	"/norestart", `
	"/mergetasks=!runcode,desktopicon,quicklaunchicon,addcontextmenufiles,addcontextmenufolders,associatewithfiles,addtopath" `
	-NoNewWindow -Wait -PassThru

exit $process.ExitCode
