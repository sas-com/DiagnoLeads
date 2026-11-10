# DiagnoLeads v2 API Documentation

> **OpenAPI Specification**: [openapi/openapi.json](../openapi/openapi.json)
>
> **View Interactive Docs**: `npx @redocly/cli preview-docs openapi/openapi.json`

## Overview

DiagnoLeads v2 provides a REST-like API for managing leads, organizations, and AI-powered features.

## Base URLs

| Environment | URL |
|------------|-----|
| Development | `http://localhost:3000` |
| Production | `https://diagnoleads.com` |

## Authentication

Most endpoints require authentication. Use the session cookie or Bearer token obtained from `/api/auth`.

```bash
# Example with Bearer token
curl -H "Authorization: Bearer <token>" \
  https://diagnoleads.com/api/trpc/leads.list?organizationId=<uuid>
```

## Rate Limiting

| Endpoint Type | Limit |
|--------------|-------|
| Standard | 100 requests/minute |
| AI endpoints | 20 requests/minute |

---

## Endpoints

### System

#### Health Check
```
GET /api/health
```

Returns service health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Leads

#### List Leads
```
GET /api/trpc/leads.list
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| organizationId | UUID | Yes | Organization ID |
| limit | integer | No | Items per page (default: 20) |
| offset | integer | No | Items to skip (default: 0) |
| status | string | No | Filter by status (new, contacted, qualified, converted) |
| source | string | No | Filter by source (website, embed, api) |
| search | string | No | Search in name, email, company |

**Response:**
```json
{
  "leads": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "organizationId": "...",
      "email": "john@acme.com",
      "name": "John Doe",
      "company": "Acme Corp",
      "status": "new",
      "score": 85,
      "source": "website",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 100
}
```

#### Create Lead
```
POST /api/trpc/leads.create
```

**Request Body:**
```json
{
  "organizationId": "550e8400-e29b-41d4-a716-446655440000",
  "email": "jane@corp.com",
  "name": "Jane Smith",
  "company": "Corp Inc",
  "status": "new",
  "source": "api"
}
```

#### Get Lead
```
GET /api/trpc/leads.get?organizationId=<uuid>&id=<uuid>
```

#### Update Lead
```
POST /api/trpc/leads.update
```

**Request Body:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "organizationId": "...",
  "status": "contacted",
  "score": 90
}
```

#### Delete Lead
```
POST /api/trpc/leads.delete
```

**Request Body:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "organizationId": "..."
}
```

---

### Analytics

#### Get Overview Statistics
```
GET /api/trpc/analytics.getOverview
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| organizationId | UUID | Yes | Organization ID |
| dateFrom | date | No | Start date filter |
| dateTo | date | No | End date filter |

**Response:**
```json
{
  "totalLeads": 500,
  "newLeads": 120,
  "contactedLeads": 200,
  "qualifiedLeads": 150,
  "convertedLeads": 30,
  "conversionRate": 6.0,
  "averageScore": 72.5
}
```

#### Get Conversion Funnel
```
GET /api/trpc/analytics.getConversionFunnel
```

**Response:**
```json
{
  "stages": [
    { "name": "new", "count": 500, "cumulativeCount": 500, "percentage": 100, "conversionRate": null },
    { "name": "contacted", "count": 350, "cumulativeCount": 350, "percentage": 70, "conversionRate": 70 },
    { "name": "qualified", "count": 150, "cumulativeCount": 150, "percentage": 30, "conversionRate": 42.8 },
    { "name": "converted", "count": 30, "cumulativeCount": 30, "percentage": 6, "conversionRate": 20 }
  ],
  "totalLeads": 500,
  "overallConversionRate": 6.0,
  "averageConversionDays": 14.5
}
```

---

### AI Features

#### Score Lead with AI
```
POST /api/trpc/ai.scoreLead
```

Uses Claude AI to analyze and score a lead based on company profile and engagement signals.

**Request Body:**
```json
{
  "organizationId": "...",
  "leadId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "score": 85,
  "confidence": "high",
  "reasoning": "Large technology company with immediate timeline and substantial budget indicates strong purchase intent.",
  "recommendedActions": [
    "Schedule discovery call within 24 hours",
    "Prepare custom demo focusing on scale features"
  ],
  "priority": "high"
}
```

#### Semantic Search
```
POST /api/trpc/ai.semanticSearch
```

Search leads using natural language with AI embeddings.

**Request Body:**
```json
{
  "organizationId": "...",
  "query": "technology companies interested in scaling",
  "limit": 10
}
```

**Response:**
```json
[
  {
    "id": "...",
    "email": "john@acme.com",
    "name": "John Doe",
    "company": "Acme Corp",
    "similarity": 0.92
  }
]
```

---

### Organizations

#### List Organizations
```
GET /api/trpc/organizations.list
```

Returns organizations the authenticated user is a member of.

#### Create Organization
```
POST /api/trpc/organizations.create
```

**Request Body:**
```json
{
  "name": "My Company",
  "slug": "my-company"
}
```

---

### Members

#### List Members
```
GET /api/trpc/members.list?organizationId=<uuid>
```

#### Invite Member
```
POST /api/trpc/members.invite
```

**Request Body:**
```json
{
  "organizationId": "...",
  "email": "newuser@company.com",
  "role": "member"
}
```

**Roles:**
- `owner` - Full control of organization
- `admin` - Admin access
- `member` - Standard member access
- `group_owner` - Full control of group hierarchy
- `group_admin` - Read access to entire group
- `parent_viewer` - Read-only access to child organizations

---

### Webhooks

#### List Webhooks
```
GET /api/trpc/webhooks.list?organizationId=<uuid>
```

#### Create Webhook
```
POST /api/trpc/webhooks.create
```

**Request Body:**
```json
{
  "organizationId": "...",
  "name": "Lead Notifications",
  "url": "https://example.com/webhook",
  "events": ["lead.created", "lead.status_changed"]
}
```

**Available Events:**
- `lead.created` - New lead created
- `lead.updated` - Lead information updated
- `lead.deleted` - Lead deleted
- `lead.status_changed` - Lead status changed
- `lead.scored` - Lead scored by AI
- `diagnostic.submitted` - Diagnostic form submitted
- `diagnostic.completed` - Diagnostic completed
- `organization.member_added` - Member added
- `organization.member_removed` - Member removed
- `blog.published` - Blog post published
- `faq.published` - FAQ published

**Allowed destinations (#321):** the URL must be `https:` on the default port (443), without a
user name or password. Outside production (`NODE_ENV` other than `production`) `http:` on port 80
is accepted as well. IP addresses in private, loopback, link-local, CGNAT, multicast, unspecified,
documentation or other reserved ranges (IPv4 and IPv6, including IPv4-mapped forms and
169.254.169.254) are refused, as are `localhost`, names without a dot, and names under
`.localhost`, `.local`, `.internal`, `.home.arpa`, `.arpa`, `.lan`, `.intranet` and `.corp`.
Create and update answer `BAD_REQUEST` (`destination_not_allowed (<reason>)`). Before every
delivery the host name is resolved and the delivery is refused if any address is in a blocked
range; redirects are not followed (a 3xx answer is a failure). A refused delivery stores
`Destination not allowed (<reason>)` and is not retried. The check and the connection resolve
the name separately, so a DNS answer that changes in between (DNS rebinding) is not fully
excluded; pinning the address would need a custom connector.

#### Test Webhook
```
POST /api/trpc/webhooks.test
```
Sends one delivery marked `"test": true` to the chosen webhook. It is tried once: a failure is not
retried and does not count towards the webhook's failure count. At most 3 test sends per webhook
in 10 minutes (counted from the stored deliveries), 10 per organization in an hour and 20 per user
in an hour across organizations (counted in `public_rate_limits`, so deleting and recreating a
webhook does not reset them); see `WEBHOOK_TEST_SEND_LIMITS`. Over a limit the answer is
`TOO_MANY_REQUESTS`.

---

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Descriptive error message",
    "code": "ERROR_CODE"
  }
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| UNAUTHORIZED | 401 | Authentication required |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| BAD_REQUEST | 400 | Invalid request data |
| INTERNAL_SERVER_ERROR | 500 | Server error |

---

## Webhook Signature Verification

Webhooks are signed using HMAC-SHA256. The signature is included in the `X-Webhook-Signature` header.

Format: `t=<timestamp>,v1=<signature>`

**Verification (Node.js):**
```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const [tPart, vPart] = signature.split(',');
  const timestamp = tPart.split('=')[1];
  const expectedSig = vPart.split('=')[1];

  const signPayload = `${timestamp}.${payload}`;
  const computedSig = crypto
    .createHmac('sha256', secret)
    .update(signPayload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSig),
    Buffer.from(computedSig)
  );
}
```

---

## Webhook Delivery: Timing, Order and Retries

- **Timing**: an event is sent right after the change, after the response to the user. When one change makes many events (a bulk status change, a bulk delete), those that do not fit in about 15 seconds are queued and sent by the daily retry run (03:00 UTC). Such a delivery can arrive **up to about 24 hours later**.
- **Retries**: a delivery that fails (any answer other than 2xx, a network error or a timeout) is retried by the same daily run, up to the webhook's `maxRetries` (3 by default). A delivery not sent within 3 days is given up. Changing the webhook's URL cancels the deliveries still waiting for a retry.
- **Order is not guaranteed**: retried and queued deliveries can arrive after newer ones. For lead events, keep the version with the newest `data.updatedAt` and ignore an older one.
- **The same delivery can arrive twice** (for example when your answer was lost on the way). `X-Webhook-ID` stays the same across the retries of one delivery: use it to ignore a delivery you already handled.
- **Answer quickly**: answer with a 2xx status within 8 seconds and do the work afterwards. A slower answer counts as a failure.
- **Personal data**: the lead events (except `lead.deleted`) and `diagnostic.submitted` send the lead's email address, name, company and phone number. Saving a webhook that sends them needs a confirmation. Once a delivery is finished, they are removed from the delivery history in DiagnoLeads.

---

## SDK Support

SDKs for popular languages are planned:

- [ ] TypeScript/JavaScript
- [ ] Python
- [ ] Go

For now, use the OpenAPI specification to generate clients using tools like:
- [openapi-generator](https://openapi-generator.tech/)
- [openapi-typescript](https://github.com/drwpow/openapi-typescript)
