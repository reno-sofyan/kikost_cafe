package com.kione.pos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EscPosPrinterPlugin.class);
        registerPlugin(UsbSerialPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
