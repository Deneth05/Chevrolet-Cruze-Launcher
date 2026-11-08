package com.deneth.cruzelauncher;

import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

/**
 * Empty notification listener. Being enabled ("Allow media access") is what lets the launcher
 * read now-playing info from Spotify, YouTube Music, Bluetooth audio, etc. via MediaSessionManager.
 */
public class MediaListener extends NotificationListenerService {

    public static boolean isEnabled(Context c) {
        String flat = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        if (flat == null) return false;
        String me = new ComponentName(c, MediaListener.class).flattenToString();
        for (String s : flat.split(":")) if (s.equals(me)) return true;
        return false;
    }
}
