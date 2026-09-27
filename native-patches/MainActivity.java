package com.sanju.voiceassistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.sanju.voiceassistant.plugins.PhoneControlPlugin;
import com.sanju.voiceassistant.plugins.VoiceInputPlugin;
import com.sanju.voiceassistant.plugins.TtsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhoneControlPlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(TtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
