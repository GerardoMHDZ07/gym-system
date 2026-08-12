# Kubernetes (local, minikube)

Manifests para correr gym-system completo en un cluster de Kubernetes local.
Pensado para minikube — no para un cluster gestionado en la nube (eso sería
un paso posterior, no necesario para portafolio).

## Prerequisito: apuntar Docker a minikube

Todas las imágenes se construyen directo en el daemon de Docker de minikube
(no hace falta ningún registry). Esto es por sesión de terminal — si abres
una terminal nueva, hay que repetirlo:

```bash
eval $(minikube docker-env)
```

## Fase 1 — Namespace, ConfigMap y Secret

```bash
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-configmap.yaml
```

`01-secret.example.yaml` documenta qué claves espera el Secret, con valores
falsos. El real se crea de forma **imperativa**, directo en tu terminal, para
que el valor real nunca toque un archivo en disco que podrías comitear por
accidente:

```bash
kubectl create secret generic gym-system-secrets \
  --namespace=gym-system \
  --from-literal=DATABASE_URL='<tu connection string de Supabase, Session pooler, SIN los símbolos < >>' \
  --from-literal=JWT_SECRET='<genera uno nuevo>' \
  --from-literal=MCP_API_KEY='<el mismo de Render, o uno nuevo>'
```

Verificación:
```bash
kubectl get namespace gym-system
kubectl get configmap gym-system-config -n gym-system
kubectl get secret gym-system-secrets -n gym-system
```

## Fase 2 — Backend

```bash
docker build -t gym-backend:local ./backend    # desde la raíz del repo, no desde k8s/
kubectl apply -f 02-backend-deployment.yaml
kubectl apply -f 02-backend-service.yaml
```

Verificación (confirma que llega a Supabase de verdad, no solo que el pod prende):
```bash
kubectl get pods -n gym-system
kubectl port-forward -n gym-system svc/gym-backend 4000:4000
# en otra terminal:
curl -X POST http://127.0.0.1:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gym.local","password":"demo1234"}'
```

## Fase 3 — Frontend + nginx

El `nginx.conf` horneado en la imagen apunta a la URL pública de Render. Para
Kubernetes se sobreescribe con un ConfigMap montado como volumen (mismo
Dockerfile, misma imagen — solo cambia la config en tiempo de ejecución).

```bash
docker build -t gym-frontend:local ./frontend
kubectl apply -f 03-frontend-nginx-configmap.yaml
kubectl apply -f 03-frontend-deployment.yaml
kubectl apply -f 03-frontend-service.yaml
```

Verificación:
```bash
kubectl get pods -n gym-system
minikube service gym-frontend -n gym-system --url
```
Abre la URL, deberías poder loguearte con `admin@gym.local` / `demo1234`.

## Fase 4 — MCP server

```bash
docker build -t gym-mcp:local ./mcp-server
kubectl apply -f 04-mcp-deployment.yaml
kubectl apply -f 04-mcp-service.yaml
```

Verificación:
```bash
kubectl get pods -n gym-system
minikube service gym-mcp -n gym-system --url
```
Pégale `/health` a esa URL — debería responder `{"ok":true}`.

Para conectar Claude Desktop a este MCP local (en vez del de Render), usa la
misma configuración de `mcp-remote` que ya tienes, cambiando solo la URL por
la que te dé `minikube service` más `/mcp`, y el header `X-MCP-API-Key` por
el valor real que pusiste en el Secret de la Fase 1.

## Comandos útiles

```bash
kubectl get all -n gym-system              # todo lo que existe en el namespace
kubectl logs -n gym-system -l app=<nombre> # logs de cualquiera de los 3 servicios
kubectl rollout restart deployment <nombre> -n gym-system  # reiniciar tras cambiar un secret/config
minikube dashboard                          # UI web de todo el cluster
```
