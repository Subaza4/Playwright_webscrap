# pruebas-bun
To install dependencies:
```bash
bun install
```
To run:
```bash
bun run index.ts
```

PARA CREAR EL CONTENEDOR DE DOCKER:
docker run -it --name websc -v /media/davicho/Archivos/2026/docker/playwright:/usr/src/app -p 3000:3000 -w /usr/src/app mcr.microsoft.com/playwright:v1.58.0-noble /bin/bash

PASOS PARA INSTALAR BUN
apt-get update
apt-get install unzip #OBLIGATORIO INSTALAR PRIMERO PARA NO TENER PROBLEMAS CON EL DESEMPAQUETADO 
curl -fsSL https://bun.sh/install | bash
export PATH="/root/.bun/bin:$PATH"
#AGREGAR BUN AL BASH, IMAGINO COMO VARIABLE DE ENTORNO O ALGO PARECIDO
source ~/.bashrc
bun --version

