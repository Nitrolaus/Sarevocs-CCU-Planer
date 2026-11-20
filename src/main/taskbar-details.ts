import path from 'node:path';import type {AppDetailsOptions} from 'electron';
export const APP_USER_MODEL_ID='com.squirrel.SarevocsCCUPlaner.Sarevocs-CCU-Planer';
/** Windows must read the icon from the real EXE, not an old Squirrel launcher or an ASAR-internal path. */
export function taskbarDetails(executable:string,name:string):AppDetailsOptions{
 if(!path.win32.isAbsolute(executable)||/["\r\n]/.test(executable))throw Error('TASKBAR_EXECUTABLE');
 return {appId:APP_USER_MODEL_ID,appIconPath:executable,appIconIndex:0,relaunchCommand:'"'+executable+'"',relaunchDisplayName:name};
}
