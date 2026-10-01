package com.sanju.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhoneControlPlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(TtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
