Option Explicit

Dim shell, fileSystem, projectRoot, quote, command, address, attempt
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
quote = Chr(34)
address = "http://127.0.0.1:4319"
shell.CurrentDirectory = projectRoot
command = shell.ExpandEnvironmentStrings("%ComSpec%") & " /d /s /c " & quote & quote & projectRoot & "\BayTools.cmd" & quote & " --background" & quote

If WScript.Arguments.Named.Exists("validate") Then
  WScript.Echo command
  WScript.Quit 0
End If

If ServerIsReady(address) Then
  shell.Run address, 1, False
  WScript.Quit 0
End If

shell.Run command, 0, False

For attempt = 1 To 480
  WScript.Sleep 250
  If ServerIsReady(address) Then
    shell.Run address, 1, False
    WScript.Quit 0
  End If
Next

shell.Popup "BayTools failed to start. See Doc\logs\baytools.log.", 0, "BayTools", 16

Function ServerIsReady(url)
  Dim request
  On Error Resume Next
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 250, 250, 250, 250
  request.Open "GET", url & "/api/session", False
  request.Send
  ServerIsReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function
