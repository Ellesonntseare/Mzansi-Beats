Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Choose the folder whose videos EVERY Mzansi Beats website visitor can watch."
$dialog.ShowNewFolderButton = $false
$preferred = "C:\Users\elles\Videos"
if (!(Test-Path -LiteralPath $preferred -PathType Container)) {
    $preferred = [Environment]::GetFolderPath('MyVideos')
}
if ($preferred -and (Test-Path -LiteralPath $preferred -PathType Container)) {
    $dialog.SelectedPath = $preferred
}
Write-Host "Select your PUBLIC video folder (do not select a folder containing private videos)."
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Cancelled; the existing setting has not changed."
    exit 1
}
$dir = $dialog.SelectedPath
if (!(Test-Path -LiteralPath $dir -PathType Container)) {
    Write-Host "Folder not found: $dir"
    exit 1
}
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'VIDEO-FOLDER.txt'), $dir, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Selected PUBLIC video library: $dir"
Write-Host "Restart the Node.js server to apply this change."
