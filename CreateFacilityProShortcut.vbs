Set oWS = WScript.CreateObject("WScript.Shell")
appDir = "C:\Users\Kayode\Documents\My Apps\FacilityPro"
desktopPath = oWS.SpecialFolders("Desktop")
sLinkFile = desktopPath & "\Facility Pro.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = appDir & "\node_modules\electron\dist\electron.exe"
oLink.Arguments = """" & appDir & """"
oLink.WorkingDirectory = appDir
oLink.IconLocation = appDir & "\FacilityPro.ico"
oLink.WindowStyle = 1
oLink.Description = "Launch Facility Pro Desktop"
oLink.Save
MsgBox "Facility Pro shortcut created on your Desktop.", 0, "Facility Pro"
