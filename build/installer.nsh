!macro preInit
  StrCpy $INSTDIR "$PROGRAMFILES64\\OfficeGhost"
!macroend

Function .onVerifyInstDir
  StrCpy $0 "$INSTDIR"
  StrLen $1 "$0"
  IntCmp $1 11 done done done
  StrCpy $2 "$0" 11 -11
  StrCmp "$2" "OfficeGhost" done 0
  StrCpy $INSTDIR "$INSTDIR\\OfficeGhost"
done:
FunctionEnd
