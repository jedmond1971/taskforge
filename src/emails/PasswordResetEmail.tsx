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

interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  expiresAt: Date;
}

export function PasswordResetEmail({ name, resetUrl, expiresAt }: PasswordResetEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your JedForge password</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>JedForge</Text>
          </Section>

          <Section style={content}>
            <Heading style={heading}>Reset your password</Heading>
            <Text style={paragraph}>
              Hi {name}, we received a request to reset the password for your JedForge account.
            </Text>

            <Section style={buttonContainer}>
              <Button href={resetUrl} style={button}>
                Choose a new password
              </Button>
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              This link works once and expires at {format(expiresAt, "h:mm a 'on' MMMM d, yyyy")}. If you
              didn&apos;t ask for this, you can ignore this email and your password will stay the same.
              Resetting it signs you out everywhere.
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
