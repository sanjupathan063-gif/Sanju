package com.sanju.voiceassistant.plugins;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "PhoneControl",
    permissions = {
        @Permission(strings = {Manifest.permission.CALL_PHONE}, alias = "callPhone")
    }
)
public class PhoneControlPlugin extends Plugin {

    @PluginMethod
    public void makeCall(PluginCall call) {
        String phoneNumber = call.getString("number");
        if (phoneNumber == null || phoneNumber.isEmpty()) {
            call.reject("Phone number is required");
            return;
        }

        try {
            Intent callIntent = new Intent(Intent.ACTION_DIAL);
            callIntent.setData(Uri.parse("tel:" + phoneNumber));
            callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(callIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("dialedNumber", phoneNumber);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to initiate call: " + e.getMessage());
        }
    }
}
