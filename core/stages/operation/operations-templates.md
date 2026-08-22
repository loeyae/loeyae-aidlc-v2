---
slug: operations-templates
number: "4.2"
name: 运维模板
execution: CONDITIONAL
lead: aidlc-operations-agent
scopes: [feature, enterprise, mvp]
requires: [operations]
produces: [docs/aidlc/operation/templates/]
---

# Operations 配置模板

> **加载时机**：仅在 `operations-operations.md` O2 交付配置生成时加载。
> **不要在其他阶段预加载此文件。**

---

## Dockerfile 模板

### Spring Boot 项目
```dockerfile
# {项目名} Dockerfile
FROM eclipse-temurin:17-jre-alpine

LABEL maintainer="{团队名}"
LABEL description="{项目描述}"

WORKDIR /app

# 复制构建产物
COPY target/*.jar app.jar

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# JVM 参数（容器友好）
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

EXPOSE {端口}

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### Node.js 项目
```dockerfile
# {项目名} Dockerfile
FROM node:18-alpine

LABEL maintainer="{团队名}"
LABEL description="{项目描述}"

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production
COPY {源代码目录} ./{源代码目录}

USER node

EXPOSE {端口}

ENTRYPOINT ["node", "{入口文件}"]
```

### Python 项目
```dockerfile
# {项目名} Dockerfile
FROM python:3.11-slim

LABEL maintainer="{团队名}"
LABEL description="{项目描述}"

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY {源代码目录} ./{源代码目录}

RUN useradd -m appuser
USER appuser

EXPOSE {端口}

ENTRYPOINT ["python", "{入口文件}"]
```

### Vue 3 前端项目（多阶段构建）
```dockerfile
# {项目名} Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### 通用规则
- 使用 Alpine 或 slim 基础镜像（最小化体积）
- 使用非 root 用户运行
- 合理利用 Docker 层缓存（依赖安装在源代码复制之前）
- 添加 LABEL 标注维护者和描述

---

## Jenkinsfile 模板

```groovy
node {
    properties([
            rateLimitBuilds([count: 3, durationName: 'hour', userBoost: true]),
            disableConcurrentBuilds(),
            buildDiscarder(logRotator(artifactDaysToKeepStr: '', artifactNumToKeepStr: '', daysToKeepStr: '', numToKeepStr: '10')),
            parameters([
                string(name: 'IMAGE_HUB', defaultValue: '{镜像仓库地址}', description: 'image hub'),
                string(name: 'IMAGE_NAME', defaultValue: '{镜像名称}', description: 'image name'),
                string(name: 'IMAGE_TAG', defaultValue: 'latest', description: 'image tag'),
                choice(choices: ['build', 'deploy'], description: 'task type', name: 'TASK_TYPE'),
                choice(choices: ['test', 'prod'], description: 'deploy env', name: 'ENV_LABEL'),
                gitParameter(branchFilter: 'origin/(.*)', defaultValue: 'main', name: 'BRANCH', type: 'PT_BRANCH', selectedValue: 'DEFAULT', useRepository: '{Git仓库地址}')
            ])
    ])
    stage("Checkout") {
        checkout([
            $class: 'GitSCM',
            branches: [[name: params.BRANCH]],
            doGenerateSubmoduleConfigurations: false,
            extensions: [], submoduleCfg: [],
            userRemoteConfigs: [[credentialsId: '{Git凭证ID}', url: '{Git仓库地址}']]
        ])
    }
    stage("Package") {
        if (params.TASK_TYPE == 'build') {
            sh """
            docker build -t ${params.IMAGE_HUB}${params.IMAGE_NAME}:latest ./
            """
        }
    }
    stage("Image push") {
        if (params.TASK_TYPE == 'build') {
            def latestTag = "${params.IMAGE_HUB}${params.IMAGE_NAME}:latest"
            withCredentials([dockerCert(credentialsId: 'docker-client', variable: 'DOCKER_CERT_PATH')]) {
                try {
                    sh "docker push $latestTag"
                } catch (exc) {
                    println("Push image failure")
                    print(exc.getMessage())
                    currentBuild.result = 'FAILURE'
                }
                sh "docker rmi $latestTag"
            }
        }
    }
    stage("deploy") {
        if (params.TASK_TYPE == 'deploy') {
            def buildId = 1
            if (params.ENV_LABEL == 'prod') {
                buildId = params.IMAGE_TAG
            } else {
                try { buildId = Integer.valueOf(currentBuild.id) } catch (exc) {}
            }
            if (params.ENV_LABEL == 'test') {
                def imageTag = "${params.IMAGE_HUB}${params.IMAGE_NAME}:${buildId}"
                def latestTag = "${params.IMAGE_HUB}${params.IMAGE_NAME}:latest"
                withCredentials([dockerCert(credentialsId: 'docker-client', variable: 'DOCKER_CERT_PATH')]) {
                    try {
                        sh """
                            docker pull $latestTag
                            docker tag $latestTag $imageTag
                            docker push $imageTag
                        """
                    } catch (exc) {
                        println("pull image failure")
                        currentBuild.result = 'FAILURE'
                    }
                    try { sh "docker rmi $latestTag" } catch (exc) {}
                }
            }
            def source = "deployment-${params.ENV_LABEL}.yml"
            sh "sed -e 's#{TAG}#${buildId}#g' ${source} > deployment-{服务名}.yml"
            withCredentials([file(credentialsId: '{集群凭据ID}', variable: 'KUBECONFIG')]) {
                sh "kubectl apply -f deployment-{服务名}.yml --kubeconfig=$KUBECONFIG"
            }
        }
    }
    stage("Post") {
        echo "pipeline completed"
        // 环境晋级与生产审批仅按 operations-plan.md 中已确认的发布策略配置。
    }
}
```

### Spring Boot 额外 Build 阶段
```groovy
stage("Build") {
    if (params.TASK_TYPE == 'build') {
        sh "mvn clean package -DskipTests -P${params.ENV_LABEL}"
    }
}
```

### 前端项目额外 Build 阶段
```groovy
stage("Build") {
    if (params.TASK_TYPE == 'build') {
        sh """
        pnpm install --frozen-lockfile
        pnpm build
        """
    }
}
```

---

## Kubernetes 部署清单模板

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: {服务名}
  namespace: {命名空间}
spec:
  ports:
    - port: {服务端口}
      targetPort: {容器端口}
      name: {端口名称}
  selector:
    app: {服务名}

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {服务名}
  namespace: {命名空间}
spec:
  replicas: {副本数}
  selector:
    matchLabels:
      app: {服务名}
  template:
    metadata:
      labels:
        app: {服务名}
    spec:
      imagePullSecrets:
        - name: {镜像拉取密钥}
      containers:
        - name: {服务名}
          image: {镜像仓库地址}{镜像名称}:{TAG}
          imagePullPolicy: Always
          ports:
            - containerPort: {容器端口}
              protocol: TCP
              name: {端口名称}
          env:
            - name: TZ
              value: Asia/Shanghai
          resources:
            limits:
              memory: "{内存上限}"
              cpu: "{CPU上限}"
            requests:
              memory: "{内存请求}"
              cpu: "{CPU请求}"
          livenessProbe:
            httpGet:
              path: {健康检查路径}
              port: {容器端口}
            initialDelaySeconds: {初始延迟}
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: {健康检查路径}
              port: {容器端口}
            initialDelaySeconds: {初始延迟}
            periodSeconds: 10

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {服务名}
  namespace: {命名空间}
spec:
  ingressClassName: {Ingress类型}
  rules:
    - host: {域名}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {服务名}
                port:
                  name: {端口名称}
  tls:
    - hosts:
        - {域名}
      secretName: {TLS证书密钥名}
```

**test 与 prod 差异**：replicas、resources limits、namespace、环境变量（数据库地址等）。

---

## Nginx 配置模板（仅前端项目）

```nginx
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api {
        proxy_pass {后端API地址};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

---

## .dockerignore 模板

```
# 通用
.git
.gitignore
*.md
docs/
.idea/
.vscode/
.kiro/

# Node.js
node_modules/
npm-debug.log*

# Java
target/
*.class
*.jar
!target/*.jar

# Python
__pycache__/
*.pyc
.venv/
venv/

# 前端
dist/
node_modules/
```

---

## 部署文档模板

### deployment-guide.md 模板

参见 `operations-operations.md` O3 配置验证与部署文档 执行时生成，格式包含：
- 项目信息
- CI/CD 流程概览（build流程 + deploy流程 + 自动触发链）
- 环境配置（test + prod）
- 手动操作（构建、部署、回滚）
- 健康检查
- 资源配置表
- 故障排除（镜像拉取失败、Pod启动失败、健康检查失败）
