"""
Servidor local ultraligero para ZapatasPro
Ejecuta el servidor web y abre automáticamente la aplicación en el navegador predeterminado.
"""

import http.server
import socketserver
import webbrowser
import os

PORT = 8090

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            super().end_headers()

    Handler = NoCacheHandler
    Handler.extensions_map.update({
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.html': 'text/html',
    })

    global PORT
    for p in range(PORT, PORT + 20):
        try:
            with socketserver.TCPServer(("", p), Handler) as httpd:
                print(f"=======================================================")
                print(f"  ZapatasPro - Servidor de Diseño de Zapatas")
                print(f"  URL Local: http://localhost:{p}")
                print(f"=======================================================")
                webbrowser.open(f"http://localhost:{p}")
                print("Presione Ctrl+C para detener el servidor.")
                httpd.serve_forever()
                break
        except OSError:
            continue

if __name__ == '__main__':
    run_server()
