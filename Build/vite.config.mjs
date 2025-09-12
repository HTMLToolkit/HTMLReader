// vite.config.js
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: './',
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['robots.txt'],
      manifest: {
        "name": "HTMLReader",
        "short_name": "HTMLReader",
        "description": "A modern, feature-rich EPUB reader with library management and offline support",
        "version": "2.2.0",
        "manifest_version": 3,
        "start_url": "/",
        "display": "standalone",
        "orientation": "any",
        "theme_color": "#2196F3",
        "background_color": "#f5f5f5",
        "scope": "/",
        "lang": "en-US",
        "dir": "ltr",
        "categories": ["books", "education", "productivity", "utilities"],
        "icons": [
          {
            "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%232196F3' width='192' height='192' rx='24'/%3E%3Ctext x='96' y='120' text-anchor='middle' fill='white' font-size='80' font-family='Arial'%3E📚%3C/text%3E%3C/svg%3E",
            "sizes": "192x192",
            "type": "image/svg+xml",
            "purpose": "any"
          },
          {
            "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect fill='%232196F3' width='512' height='512' rx='64'/%3E%3Ctext x='256' y='320' text-anchor='middle' fill='white' font-size='200' font-family='Arial'%3E📚%3C/text%3E%3C/svg%3E",
            "sizes": "512x512",
            "type": "image/svg+xml",
            "purpose": "any"
          },
          {
            "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%23ffffff' width='192' height='192' rx='24'/%3E%3Ctext x='96' y='120' text-anchor='middle' fill='%232196F3' font-size='80' font-family='Arial'%3E📚%3C/text%3E%3C/svg%3E",
            "sizes": "192x192",
            "type": "image/svg+xml",
            "purpose": "maskable"
          }
        ],
        "shortcuts": [
          {
            "name": "Open Library",
            "short_name": "Library",
            "description": "Browse your EPUB library",
            "url": "/?action=library",
            "icons": [
              {
                "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Ctext x='48' y='60' text-anchor='middle' font-size='48'%3E📚%3C/text%3E%3C/svg%3E",
                "sizes": "96x96"
              }
            ]
          },
          {
            "name": "Open Book",
            "short_name": "Open",
            "description": "Select an EPUB file to read",
            "url": "/?action=open",
            "icons": [
              {
                "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Ctext x='48' y='60' text-anchor='middle' font-size='48'%3E📂%3C/text%3E%3C/svg%3E",
                "sizes": "96x96"
              }
            ]
          }
        ],
        "screenshots": [
          {
            "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'%3E%3Crect fill='%23f5f5f5' width='1280' height='720'/%3E%3Crect fill='%232196F3' width='1280' height='80'/%3E%3Ctext x='40' y='50' fill='white' font-size='24' font-weight='bold'%3EHTMLReader%3C/text%3E%3Crect fill='white' x='40' y='120' width='1200' height='560' rx='8'/%3E%3Ctext x='640' y='400' text-anchor='middle' fill='%23718096' font-size='48'%3E📖%3C/text%3E%3Ctext x='640' y='450' text-anchor='middle' fill='%23718096' font-size='18'%3EModern EPUB Reader%3C/text%3E%3C/svg%3E",
            "sizes": "1280x720",
            "type": "image/svg+xml",
            "form_factor": "wide",
            "label": "Main reading interface"
          },
          {
            "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 750 1334'%3E%3Crect fill='%23f5f5f5' width='750' height='1334'/%3E%3Crect fill='%232196F3' width='750' height='120'/%3E%3Ctext x='30' y='75' fill='white' font-size='36' font-weight='bold'%3EHTMLReader%3C/text%3E%3Crect fill='white' x='30' y='150' width='690' height='1100' rx='12'/%3E%3Ctext x='375' y='700' text-anchor='middle' fill='%23718096' font-size='72'%3E📱%3C/text%3E%3Ctext x='375' y='780' text-anchor='middle' fill='%23718096' font-size='24'%3EMobile Reading%3C/text%3E%3C/svg%3E",
            "sizes": "750x1334",
            "type": "image/svg+xml",
            "form_factor": "narrow",
            "label": "Mobile reading experience"
          }
        ],
        "share_target": {
          "action": "/",
          "method": "GET",
          "params": {
            "files": [
              {
                "name": "epub_files",
                "accept": [".epub", "application/epub+zip"]
              }
            ]
          }
        },
        "file_handlers": [
          {
            "action": "/",
            "accept": {
              "application/epub+zip": [".epub"]
            },
            "launch_type": "single-client"
          }
        ],
        "protocol_handlers": [
          {
            "protocol": "web+epub",
            "url": "/?epub=%s"
          }
        ],
        "display_override": [
          "window-controls-overlay",
          "minimal-ui",
          "standalone",
          "browser"
        ],
        "prefer_related_applications": false,
        "related_applications": [],
        "edge_side_panel": {
          "preferred_width": 400
        },
        "launch_handler": {
          "client_mode": "navigate-existing"
        }
      },
      pwaAssets: {
        image: 'public/source.svg', // source image → generates all required icons
        preset: 'minimal-2023',
        includeHtmlHeadLinks: true,
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /.*\.(js|css|html)$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'app-shell' },
          },
          {
            urlPattern: /.*\.(png|ico|json)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'assets' },
          },
        ],
      },
    }),
  ],
  server: { open: true, allowedHosts: true },
  build: { sourcemap: true, outDir: './dist', emptyOutDir: true },
});
