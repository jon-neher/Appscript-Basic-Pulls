# Cloud Logging & Alerting Setup

The application now emits **structured JSON** logs via `src/utils/logger.ts`.  The
following one-time infrastructure steps configure Google Cloud Logging to ingest
those entries **and** create a Monitoring alert when any message is logged with
`severity >= ERROR`.

---

## 1. Log bucket (optional)

If you want to route logs to a dedicated bucket instead of the default
_global_ bucket, create it first:

```bash
gcloud logging buckets create chat-knowledge-logs \
  --location=global \
  --retention-days=30 \
  --description="Structured logs from Chat Knowledge bot"
```

## 2. Sink

Create a **sink** that routes _only_ the application’s logs (identified by the
metadata fields we emit) into the bucket.

```bash
# Update $PROJECT_ID with your target project.

LOG_FILTER='jsonPayload.severity>="DEFAULT" AND (
  jsonPayload.message:"Chat Knowledge bot" OR
  resource.labels.function_name="chat-knowledge"
)'

gcloud logging sinks create chat-knowledge-sink \
  $LOG_FILTER \
  --log-filter="$LOG_FILTER" \
  --destination="logging.googleapis.com/projects/${PROJECT_ID}/locations/global/buckets/chat-knowledge-logs" \
  --description="Routes structured bot logs into dedicated bucket"
```

> **Note**: When deploying to **Cloud Functions gen2** or **Cloud Run** the
> `resource.type` will differ. Adjust the filter accordingly.

## 3. Alert policy

Create an alert whenever an `ERROR` (or higher) severity log entry appears.

```bash
gcloud beta monitoring policies create <<'EOF'
display_name: "Chat Knowledge – Error logs"
documentation: {
  content: "An *ERROR*-level log was emitted by the Chat Knowledge bot."
  mime_type: "text/markdown"
}
combiner: "OR"
conditions: [
  {
    display_name: "Any ERROR+ log entry"
    condition_threshold: {
      filter: "resource.type=\"logging_bucket\" severity>=ERROR"
      comparison: "COMPARISON_GT"
      threshold_value: 0
      duration: "0s"
      trigger: { count: 1 }
    }
  }
]
notification_channels: ["projects/${PROJECT_ID}/notificationChannels/<CHANNEL_ID>"]
EOF
```

Replace `<CHANNEL_ID>` with an email/SMS/PubSub channel of your choice.

---

After running the steps above you can verify everything is wired correctly by
invoking the bot locally and checking **Cloud Logging → Logs Explorer** for the
structured entries, then confirming that an alert is triggered when you log an
`error()` from the REPL:

```ts
import { error } from './src/utils/logger';

error('Manual test error', { foo: 'bar' });
```

The log should appear in the *chat-knowledge-logs* bucket and trigger the
_Chat Knowledge – Error logs_ alert policy.
