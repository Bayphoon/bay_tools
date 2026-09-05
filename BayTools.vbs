Option Explicit

Dim shell, fileSystem, projectRoot, quote, launcher, command, windowStyle, waitForExit
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
quote = Chr(34)
launcher = projectRoot & "\BayTools.Launcher.ps1"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & quote & launcher & quote
windowStyle = 0
waitForExit = False

If WScript.Arguments.Named.Exists("restart") Then command = command & " -ForceRestart"
If WScript.Arguments.Named.Exists("validate") Then
  command = command & " -Validate"
  windowStyle = 1
  waitForExit = True
End If

shell.CurrentDirectory = projectRoot
shell.Run command, windowStyle, waitForExit
