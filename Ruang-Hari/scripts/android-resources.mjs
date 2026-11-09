import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root='android/app/src/main/res/';
await mkdir(root+'drawable',{recursive:true});
await writeFile(root+'drawable/ic_stat_reminder.xml','<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFFFF" android:pathData="M12,2C8.1,2 5,5.1 5,9v6l-2,3h18l-2,-3V9C19,5.1 15.9,2 12,2zM10,20h4v2h-4z"/></vector>');
// Adaptive icon, generated with vector resources, no external image dependency.
await writeFile(root+'drawable/ic_launcher_foreground.xml','<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#FFF7F8F1" android:pathData="M34,35h9v5c4,-5 8,-6 16,-6v10c-11,0 -16,4 -16,15v17h-9zM66,66h10v10H66z"/></vector>');
await mkdir(root+'mipmap-anydpi-v26',{recursive:true});
for(const name of ['ic_launcher','ic_launcher_round'])await writeFile(root+`mipmap-anydpi-v26/${name}.xml`,'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/icon_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/></adaptive-icon>');
await writeFile(root+'values/icon_background.xml','<resources><color name="icon_background">#252B20</color></resources>');
const path='android/app/src/main/AndroidManifest.xml';let manifest=await readFile(path,'utf8');
if(!manifest.includes('android.permission.POST_NOTIFICATIONS'))manifest=manifest.replace('<application','<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n    <application');
await writeFile(path,manifest);
console.log('Android icon and notification resources ready.');
