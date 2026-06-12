FROM eclipse-temurin:17-jre

WORKDIR /app

COPY target/ai-job.jar /app/ai-job.jar

EXPOSE 9100
EXPOSE 6768

ENTRYPOINT ["java", "-XX:+StartAttachListener", "-jar"]
CMD ["/app/ai-job.jar"]
