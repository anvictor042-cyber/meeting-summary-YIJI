Add-Type -AssemblyName System.Drawing
$exe = (Get-ChildItem 'D:\ClawOutput\MeetingTracker\dist\win-unpacked\*.exe' | Where-Object { $_.Name -ne 'elevate.exe' } | Select-Object -First 1).FullName
Write-Host ('EXE: ' + $exe)
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $icon.ToBitmap()
$bmp.Save('D:\ClawOutput\MeetingTracker\exe-icon-check.png', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host ('EXE_ICON_SIZE: ' + $bmp.Width + 'x' + $bmp.Height)
$icon.Dispose(); $bmp.Dispose()
