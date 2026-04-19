package com.markped.diasporaradio;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configure WebView to allow all content — needed for sports streams
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        // Allow mixed content (HTTP streams inside HTTPS app)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Enable JavaScript (already on, but explicit)
        settings.setJavaScriptEnabled(true);

        // Allow file access
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Allow universal access from file URLs (needed for blob URLs)
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);

        // Enable DOM storage
        settings.setDomStorageEnabled(true);

        // Enable media playback without user gesture
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Wide viewport for proper rendering
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // Enable hardware acceleration for video
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
    }
}
