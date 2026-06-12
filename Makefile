SERVER_DIR := ai-job-hunting-server
UI_DIR := ai-job-hunting-ui
DOCKER_DIR := $(SERVER_DIR)/src/main/resources/docker
COMPOSE_FILE := $(DOCKER_DIR)/docker-compose.yml

MAVEN ?= mvn
PNPM ?= pnpm
DOCKER_COMPOSE ?= docker compose

.PHONY: help server-dev server-package ui-dev ui-build mysql-up mysql-down docker-build docker-up docker-down docker-clean docker-logs docker-ps docker-config

help:
	@echo Commands:
	@echo   make server-dev      Start backend with dev profile
	@echo   make ui-dev          Start UI userscript dev server
	@echo   make mysql-up        Start MySQL only
	@echo   make docker-up       Package backend and start MySQL + backend
	@echo   make docker-down     Stop Docker services
	@echo   make docker-logs     Follow backend container logs
	@echo   make docker-clean    Stop services and remove Docker volumes

server-dev:
	$(MAVEN) -f $(SERVER_DIR)/pom.xml spring-boot:run -Dspring-boot.run.profiles=dev

server-package:
	$(MAVEN) -f $(SERVER_DIR)/pom.xml -DskipTests package

ui-dev:
	cd $(UI_DIR) && $(PNPM) run dev

ui-build:
	cd $(UI_DIR) && $(PNPM) run build

mysql-up:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) up -d mysql

mysql-down:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) stop mysql

docker-build: server-package
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) build ai-job

docker-up: server-package
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) up -d --build

docker-down:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) down

docker-clean:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) down -v

docker-logs:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) logs -f ai-job

docker-ps:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) ps

docker-config:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) config

ci:
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) up -d mysql
	$(DOCKER_COMPOSE) -f $(COMPOSE_FILE) up -d --build