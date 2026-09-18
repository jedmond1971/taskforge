import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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

/** Returns the real, S3-reported size of an object, or null if it doesn't exist. */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return result.ContentLength ?? null;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return null;
    throw error;
  }
}

export interface S3ObjectInfo {
  key: string;
  lastModified: Date;
  size: number;
}

/** Lists every object under a prefix with its last-modified time and size (paginated). */
export async function listObjects(prefix: string): Promise<S3ObjectInfo[]> {
  const objects: S3ObjectInfo[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    for (const o of list.Contents ?? []) {
      if (o.Key && o.LastModified) {
        objects.push({ key: o.Key, lastModified: o.LastModified, size: o.Size ?? 0 });
      }
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

/** Deletes a batch of keys, chunked to S3's 1000-object-per-request limit. */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk } }));
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = result.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
