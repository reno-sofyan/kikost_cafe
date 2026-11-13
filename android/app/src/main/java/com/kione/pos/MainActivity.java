package com.kione.pos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EscPosPrinterPlugin.class);
        registerPlugin(UsbSerialPlugin.class);
        super.onCreate(savedInstanceState);
        // Ukuran font Android (mis. Samsung "Ukuran font" besar) tak ikut memperbesar teks
        // WebView — tata letak kasir dirancang per piksel CSS, teks yang membesar memotong tombol.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
