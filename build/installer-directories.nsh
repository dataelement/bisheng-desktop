; Adapted from deepseek-ai/deepseek-harness/apps/desktop/scripts/installer-directories.nsh.
!include "LogicLib.nsh"

Var dshFinalDirectory
Var dshNewDirectory
Var dshOldDirectory
Var dshOldMoved
Var dshNewMoved

!macro dshExtractPayload FILE
  extract_user_retry_${__LINE__}:
  nsExec::ExecToStack '"$PLUGINSDIR\dsh-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${FILE}"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    DetailPrint $R1
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装解压失败 (7za 退出码: $R0)$\r$\n$\r$\n目标目录: $INSTDIR$\r$\n详细信息:$\r$\n$R1$\r$\n$\r$\n可能原因：解压文件被杀毒软件（如腾讯电脑管家、360 等）拦截或磁盘空间不足。$\r$\n$\r$\n请临时退出安全软件后点击【重试】；点击【取消】将中止安装。" IDRETRY extract_user_retry_${__LINE__}
    Call dshRollbackDirectories
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro dshStageApplication
  StrCpy $dshFinalDirectory $INSTDIR
  System::Call 'ole32::CoCreateGuid(g .r0) i .r1'
  ${If} $1 != 0
    MessageBox MB_ICONSTOP "安装初始化失败：无法生成唯一目录 GUID (错误代码: $1)"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $dshNewDirectory "$INSTDIR.new-$0"
  StrCpy $dshOldDirectory "$INSTDIR.old-$0"
  StrCpy $dshOldMoved ""
  StrCpy $dshNewMoved ""
  stage_mkdir_retry:
  ClearErrors
  CreateDirectory $dshNewDirectory
  ${If} ${Errors}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装暂存失败：无法创建暂存目录$\r$\n$\r$\n路径: $dshNewDirectory$\r$\n$\r$\n请检查是否具有写入权限或磁盘空间是否充足，或临时退出安全软件后点击【重试】；点击【取消】将中止安装。" IDRETRY stage_mkdir_retry
    SetErrorLevel 2
    Quit
  ${EndIf}
  File /oname=$PLUGINSDIR\dsh-7za.exe "${DSH_SEVENZIP_PATH}"
  StrCpy $INSTDIR $dshNewDirectory
  SetOutPath $INSTDIR
  !insertmacro installApplicationFiles
  File /oname=7zip-installer-LICENSE.txt "${DSH_SEVENZIP_LICENSE_DIR}\LICENSE.txt"
  File /oname=7zip-installer-COPYING.txt "${DSH_SEVENZIP_LICENSE_DIR}\COPYING"
  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif
  StrCpy $INSTDIR $dshFinalDirectory
  SetOutPath $PLUGINSDIR
!macroend

Function .onGUIEnd
  Call dshCleanupDirectories
FunctionEnd

Function dshCleanupDirectories
  ${If} $dshFinalDirectory != ""
    Call dshRollbackDirectories
  ${EndIf}
FunctionEnd

Function dshRollbackDirectories
  SetOutPath $PLUGINSDIR
  StrCpy $0 $dshFinalDirectory 2
  StrCpy $0 "$0\"
  System::Call 'kernel32::SetCurrentDirectory(t r0)'

  ${If} $dshNewMoved == "1"
    RMDir /r "\\?\$dshFinalDirectory"
    StrCpy $dshNewMoved ""
  ${EndIf}
  ${If} $dshOldMoved == "1"
    ClearErrors
    Rename $dshOldDirectory $dshFinalDirectory
    ${If} ${Errors}
      DetailPrint "Old application retained at $dshOldDirectory"
      Return
    ${EndIf}
    StrCpy $dshOldMoved ""
  ${EndIf}
  ${If} $dshNewDirectory != ""
    RMDir /r "\\?\$dshNewDirectory"
  ${EndIf}
  StrCpy $INSTDIR $dshFinalDirectory
FunctionEnd

Function dshPromoteDirectories
  ; SetOutPath keeps a directory handle open. Release it before either rename.
  SetOutPath $PLUGINSDIR

  ; Release any per-drive current directory handle on the target volume.
  StrCpy $0 $dshFinalDirectory 2
  StrCpy $0 "$0\"
  System::Call 'kernel32::SetCurrentDirectory(t r0)'

  ; If final directory exists and is empty (e.g. pre-created by directory page), remove it with retry.
  StrCpy $R3 0
  rmdir_empty_retry:
  ClearErrors
  ${If} ${FileExists} "$dshFinalDirectory"
    RMDir $dshFinalDirectory
    ${If} ${Errors}
      ${IfNot} ${FileExists} "$dshFinalDirectory\*.*"
        IntOp $R3 $R3 + 1
        ${If} $R3 < 5
          Sleep 200
          Goto rmdir_empty_retry
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; If final directory still exists (contains old files, or couldn't be deleted directly),
  ; move it to backup directory with retry.
  ${If} ${FileExists} "$dshFinalDirectory"
    backup_user_retry:
    StrCpy $R3 0
    backup_retry:
      ClearErrors
      Rename $dshFinalDirectory $dshOldDirectory
      ${IfNot} ${Errors}
        StrCpy $dshOldMoved "1"
        Goto backup_done
      ${EndIf}
      IntOp $R3 $R3 + 1
      ${If} $R3 < 10
        Sleep 500
        Goto backup_retry
      ${EndIf}

      System::Call "kernel32::GetLastError() i .R2"
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装目录替换失败：无法备份旧版本目录。$\r$\n$\r$\n源目录: $dshFinalDirectory$\r$\n备份目标: $dshOldDirectory$\r$\n$\r$\nWindows 错误代码: $R2$\r$\n可能原因：原安装目录中有文件被其他进程（如后台残留的程序、资源管理器、杀毒软件等）占用。$\r$\n$\r$\n建议：请确保旧版本程序已完全关闭，或临时退出安全软件后点击【重试】；点击【取消】将中止安装。" IDRETRY backup_user_retry
      Call dshRollbackDirectories
      SetErrors
      Return
    backup_done:
  ${EndIf}
  ; Promote new staged directory to final installation directory with retry.
  promote_user_retry:
  StrCpy $R3 0
  promote_retry:
    ClearErrors
    Rename $dshNewDirectory $dshFinalDirectory
    ${IfNot} ${Errors}
      StrCpy $dshNewMoved "1"
      Goto promote_done
    ${EndIf}
    IntOp $R3 $R3 + 1
    ${If} $R3 < 10
      Sleep 500
      Goto promote_retry
    ${EndIf}

    System::Call "kernel32::GetLastError() i .R2"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "安装目录替换失败：无法将新版本目录变更为正式安装目录。$\r$\n$\r$\n源目录: $dshNewDirectory$\r$\n正式目录: $dshFinalDirectory$\r$\n$\r$\nWindows 错误代码: $R2$\r$\n可能原因：目标目录被其他进程占用、权限不足或被杀毒软件（如腾讯电脑管家、360 等）拦截扫描。$\r$\n$\r$\n建议：请临时退出杀毒软件或关闭占用该目录的程序，然后点击【重试】；点击【取消】将中止安装。" IDRETRY promote_user_retry
    Call dshRollbackDirectories
    SetErrors
    Return

  promote_done:
    SetOutPath $dshFinalDirectory
    ClearErrors
FunctionEnd

!macro dshFinishDirectories
  StrCpy $dshNewMoved ""
  ${If} $dshOldMoved == "1"
    RMDir /r "\\?\$dshOldDirectory"
    StrCpy $dshOldMoved ""
  ${EndIf}
!macroend
