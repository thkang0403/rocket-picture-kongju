Option Explicit

Dim fso
Dim shell
Dim folder
Dim url
Dim logPath
Dim nodePath
Dim npmPath

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:3000"
logPath = folder & "\launcher.log"

nodePath = FindProgram("node.exe")
npmPath = FindProgram("npm.cmd")

If nodePath = "" Then
  MsgBox "Node.js was not found." & vbCrLf & vbCrLf & _
         "This game needs Node.js because it runs a local multiplayer server." & vbCrLf & _
         "Install the Node.js LTS version from https://nodejs.org/ and double-click PLAY-GAME.vbs again.", _
         vbCritical, "Game Launcher"
  WScript.Quit 1
End If

If Not fso.FolderExists(folder & "\node_modules") Then
  If npmPath = "" Then
    MsgBox "Required packages are not installed, and npm was not found." & vbCrLf & vbCrLf & _
           "Install the Node.js LTS version from https://nodejs.org/." & vbCrLf & _
           "Node.js includes npm. After installing it, double-click PLAY-GAME.vbs again.", _
           vbCritical, "Game Launcher"
    WScript.Quit 1
  End If

  Dim installCode
  installCode = shell.Run("cmd /c cd /d " & Quote(folder) & " && " & Quote(npmPath) & " install > " & Quote(logPath) & " 2>&1", 0, True)
  If installCode <> 0 Then
    MsgBox "Dependency installation failed." & vbCrLf & _
           "Check launcher.log in the project folder.", vbCritical, "Game Launcher"
    WScript.Quit installCode
  End If
End If

StopServerOnPort 3000
WScript.Sleep 800

shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(folder & "\start-server.ps1"), 0, False

If WaitForServer() Then
  shell.Run "cmd /c start " & Quote("") & " " & Quote(url), 0, False
Else
  MsgBox "The server did not start." & vbCrLf & _
         "Check launcher.log in the project folder.", vbCritical, "Game Launcher"
  WScript.Quit 1
End If

Function FindProgram(fileName)
  Dim candidates
  candidates = Array( _
    shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\" & fileName, _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\" & fileName, _
    shell.ExpandEnvironmentStrings("%LocalAppData%") & "\Programs\nodejs\" & fileName, _
    shell.ExpandEnvironmentStrings("%UserProfile%") & "\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\" & fileName _
  )

  Dim i
  For i = 0 To UBound(candidates)
    If fso.FileExists(candidates(i)) Then
      FindProgram = candidates(i)
      Exit Function
    End If
  Next

  Dim fromPath
  fromPath = FindFromPath(fileName)
  If fromPath <> "" Then
    FindProgram = fromPath
    Exit Function
  End If

  FindProgram = ""
End Function

Function FindFromPath(fileName)
  On Error Resume Next
  Dim exec
  Set exec = shell.Exec("cmd /c where " & fileName)
  If Err.Number <> 0 Then
    Err.Clear
    FindFromPath = ""
    On Error GoTo 0
    Exit Function
  End If

  Dim output
  output = Trim(exec.StdOut.ReadAll)
  If InStr(output, vbCrLf) > 0 Then
    output = Left(output, InStr(output, vbCrLf) - 1)
  End If

  FindFromPath = output
  On Error GoTo 0
End Function

Sub StopServerOnPort(port)
  On Error Resume Next
  Dim exec
  Set exec = shell.Exec("cmd /c netstat -ano | findstr :" & port)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If

  Dim output
  output = exec.StdOut.ReadAll
  If output = "" Then
    On Error GoTo 0
    Exit Sub
  End If

  Dim lines
  lines = Split(output, vbCrLf)

  Dim seen
  Set seen = CreateObject("Scripting.Dictionary")

  Dim i
  For i = 0 To UBound(lines)
    Dim line
    line = Trim(lines(i))

    If line <> "" And InStr(line, "LISTENING") > 0 Then
      Dim parts
      parts = SplitBySpaces(line)
      If UBound(parts) >= 4 Then
        Dim pid
        pid = parts(UBound(parts))
        If pid <> "0" And Not seen.Exists(pid) Then
          seen.Add pid, True
          shell.Run "cmd /c taskkill /PID " & pid & " /F >> " & Quote(logPath) & " 2>&1", 0, True
        End If
      End If
    End If
  Next

  On Error GoTo 0
End Sub

Function SplitBySpaces(value)
  Dim cleaned
  cleaned = Trim(value)

  Do While InStr(cleaned, "  ") > 0
    cleaned = Replace(cleaned, "  ", " ")
  Loop

  SplitBySpaces = Split(cleaned, " ")
End Function

Function ServerIsReady()
  On Error Resume Next
  Dim request
  Set request = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  request.setTimeouts 500, 500, 500, 500
  request.open "GET", url, False
  request.send
  ServerIsReady = (Err.Number = 0 And request.status >= 200 And request.status < 500)
  Err.Clear
  On Error GoTo 0
End Function

Function WaitForServer()
  Dim attempts
  For attempts = 1 To 60
    If ServerIsReady() Then
      WaitForServer = True
      Exit Function
    End If
    WScript.Sleep 500
  Next

  WaitForServer = False
End Function

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

