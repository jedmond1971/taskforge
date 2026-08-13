import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  endpoint: process.env.RAILWAY_BUCKET_ENDPOINT!,
  region: process.env.RAILWAY_BUCKET_REGION!,
  credentials: {
    accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY_ID!,
    secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY!,
  },
});

const bucket = process.env.RAILWAY_BUCKET_NAME!;

export async function getPresignedUploadUrl(
  key: string,
  mimeType: string,
  fileSizeBytes: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    ContentLength: fileSizeBytes,
  });
  return getSignedUrl(s3, command, { expiresIn: 15 * 60 });
}

export async function getPresignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 60 * 60 });
}

export async function putObject(
  key: string,
  body: Buffer,
  mimeType: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mimeType })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = result.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
