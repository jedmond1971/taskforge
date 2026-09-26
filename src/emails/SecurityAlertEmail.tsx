import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import type { AlertMessage } from "@/lib/alerting/deliver";

export function SecurityAlertEmail(props: AlertMessage) {
  const rows: Array<[string, string]> = [
    ["Rule", props.rule],
    ["Severity", props.severity],
    ["Subject", props.subject],
    ...(props.count !== undefined
      ? ([["Count", props.windowMinutes ? `${props.count} in ${props.windowMinutes} minutes` : String(props.count)]] as Array<[string, string]>)
      : []),
    ["Suppressed since last alert", String(props.suppressed)],
    ["Time", props.triggeredAt],
    ...(props.requestId ? ([["Request ID", props.requestId]] as Array<[string, string]>) : []),
  ];

  return (
    <Html lang="en">
      <Head />
      <Preview>{props.title}</Preview>
      <Body style={body}>
        <Container style={container}>
          {props.drill && <Text style={drillBanner}>DRILL — this is a test of the alerting path, not a real event.</Text>}
          <Heading style={heading}>{props.title}</Heading>
          <Text style={paragraph}>{props.summary}</Text>
          <Section>
            {rows.map(([k, v]) => (
              <Text key={k} style={row}>
                <strong>{k}:</strong> {v}
              </Text>
            ))}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Open Railway → Deploy Logs and filter on the event type. The request ID ties this alert to the log lines.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#f4f4f5", fontFamily: "system-ui, -apple-system, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "24px auto", padding: "24px", maxWidth: "560px", borderRadius: "8px" };
const heading = { fontSize: "20px", color: "#18181b", margin: "0 0 12px" };
const paragraph = { fontSize: "14px", color: "#3f3f46", lineHeight: "20px" };
const row = { fontSize: "13px", color: "#27272a", margin: "2px 0", wordBreak: "break-all" as const };
const hr = { borderColor: "#e4e4e7", margin: "20px 0" };
const footer = { fontSize: "12px", color: "#71717a" };
const drillBanner = { backgroundColor: "#fef3c7", color: "#92400e", padding: "8px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600 };
