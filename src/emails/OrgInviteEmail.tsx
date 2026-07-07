import { format } from "date-fns";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface OrgInviteEmailProps {
  orgName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
}

export function OrgInviteEmail({
  orgName,
  inviterName,
  acceptUrl,
  expiresAt,
}: OrgInviteEmailProps) {
  const expiresFormatted = format(expiresAt, "MMMM d, yyyy");

  return (
    <Html lang="en">
      <Head />
      <Preview>{inviterName} has invited you to join {orgName} on JedForge</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>JedForge</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>
              You&apos;ve been invited to join {orgName}
            </Heading>
            <Text style={paragraph}>
              {inviterName} has invited you to join{" "}
              <strong>{orgName}</strong> on JedForge.
            </Text>

            <Section style={buttonContainer}>
              <Button href={acceptUrl} style={button}>
                Accept Invite
              </Button>
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              This invite expires on {expiresFormatted}. If you weren&apos;t
              expecting this, you can ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: "40px 0",
};

const container: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "560px",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  backgroundColor: "#1F232B",
  padding: "24px 32px",
};

const wordmark: React.CSSProperties = {
  color: "#FF6A00",
  fontSize: "22px",
  fontWeight: "700",
  margin: 0,
  letterSpacing: "-0.3px",
};

const content: React.CSSProperties = {
  padding: "32px 32px 24px",
};

const heading: React.CSSProperties = {
  color: "#1F232B",
  fontSize: "22px",
  fontWeight: "700",
  lineHeight: "1.3",
  margin: "0 0 16px",
};

const paragraph: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 28px",
};

const buttonContainer: React.CSSProperties = {
  marginBottom: "28px",
};

const button: React.CSSProperties = {
  backgroundColor: "#FF6A00",
  borderRadius: "6px",
  color: "#FFFFFF",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  padding: "12px 24px",
  textDecoration: "none",
};

const hr: React.CSSProperties = {
  borderColor: "#e4e4e7",
  borderTopWidth: 1,
  margin: "0 0 20px",
};

const footer: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
};
