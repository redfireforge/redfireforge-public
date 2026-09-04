FROM maven:3.9.8-eclipse-temurin-17 AS build

WORKDIR /workspace
COPY pom.xml ./
COPY src ./src

# BuildKit sets TARGETARCH (amd64|arm64). Do not default to arm64 — without
# BuildKit that wrong default breaks x86_64 Linux/WSL (aarch64 protoc →
# "Syntax error: ( unexpected"). Fall back to uname -m inside the image.
ARG TARGETARCH
RUN ARCH="${TARGETARCH:-$(uname -m)}" \
  && CLASSIFIER="$(case "${ARCH}" in \
      amd64|x86_64) echo linux-x86_64 ;; \
      arm64|aarch64) echo linux-aarch_64 ;; \
      *) echo linux-x86_64 ;; \
    esac)" \
  && mvn -q -DskipTests package -Dos.detected.classifier="${CLASSIFIER}"

FROM eclipse-temurin:17-jre

WORKDIR /app
COPY --from=build /workspace/target/grpc-spring-boot-fixture-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8081 9090

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
