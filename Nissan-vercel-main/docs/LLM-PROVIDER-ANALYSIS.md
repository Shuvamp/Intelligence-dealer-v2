# LLM Provider Analysis for Assignment Agent

**Analysis Date:** 2026-06-09  
**Context:** Select free/open LLM provider to replace Anthropic API  
**Requirement:** Compatible with FastAPI + LangGraph (Python)

---

## Executive Summary

| Provider | Recommendation | Score | Best For |
|----------|---|---|---|
| **Ollama** | ⭐⭐⭐⭐⭐ **RECOMMENDED (Dev)** | 9.5/10 | Local development, privacy, zero cost |
| **OpenRouter** | ⭐⭐⭐⭐⭐ **RECOMMENDED (Prod)** | 9.0/10 | Production, model flexibility, fallbacks |
| **Groq** | ⭐⭐⭐⭐ GOOD | 7.5/10 | Speed-critical, limited free tier |
| **NVIDIA NIM** | ⭐⭐⭐ FAIR | 6.5/10 | Enterprise, complex setup |
| **Together.AI** | ⭐⭐⭐⭐ GOOD | 7.0/10 | Development, free tier with limits |
| **HuggingFace** | ⭐⭐⭐ FAIR | 6.0/10 | Prototyping, rate-limited |

---

## Detailed Analysis

### 1. OLLAMA (Local, Self-Hosted)

#### Overview
Local LLM inference engine running on your machine. No API keys, no internet required, completely free.

#### Compatibility with Requirements

| Requirement | Status | Details |
|---|---|---|
| LangGraph (Python) | ✅ YES | Native via `langchain-ollama` |
| FastAPI | ✅ YES | Works as local service |
| Free/Developer | ✅ FREE | Zero cost |
| Assignment reasoning | ✅ GOOD | Models sufficient for business logic |
| Latency | ⚠️ VARIABLE | 50-500ms depending on machine/model |

#### Setup

```bash
# Install Ollama
# Download from: https://ollama.ai

# Pull a model
ollama pull llama2       # 3.8GB
ollama pull mistral      # 4GB
ollama pull neural-chat  # 4.5GB (recommended)

# Start server
ollama serve             # Runs on localhost:11434
```

#### LangChain Integration

```python
from langchain_community.llms import Ollama

llm = Ollama(
    model="neural-chat",      # or llama2, mistral
    base_url="http://localhost:11434",
    temperature=0.7,
)

response = llm.invoke("Select best executive for hot lead")
```

#### LangGraph Integration

```python
from langgraph.graph import StateGraph
from langchain_community.llms import Ollama

class AssignmentAgent:
    def __init__(self):
        self.llm = Ollama(
            model="neural-chat",
            base_url="http://localhost:11434",
        )
        self.graph = self._build_graph()
    
    async def _select_executive_node(self, state):
        # Use self.llm instead of Anthropic client
        prompt = f"Select best executive for {state.lead_id}..."
        response = await self.llm.ainvoke(prompt)
        return {...}
```

#### Pros
- ✅ **Zero cost** — No subscriptions, no API keys, no rate limits
- ✅ **Privacy** — Data stays on your machine
- ✅ **Offline capable** — Works without internet (after model download)
- ✅ **Easy development** — Perfect for local testing
- ✅ **No vendor lock-in** — Switch models anytime
- ✅ **Good models** — Llama 2, Mistral, Neural-Chat are solid
- ✅ **Fast iteration** — No wait for API responses

#### Cons
- ❌ **Hardware requirements** — Needs GPU (or CPU, but slower)
- ❌ **Model size** — 3-4GB per model (storage)
- ❌ **Latency** — Slower than cloud APIs (50-500ms vs 500ms-2s)
- ❌ **Production deployment** — Requires container + GPU on server
- ⚠️ **Model quality** — Reasoning ability less than GPT-4/Claude

#### Model Selection for Assignment Agent

| Model | Size | Quality | Speed | Reasoning |
|---|---|---|---|---|
| **neural-chat** | 4.5GB | ⭐⭐⭐⭐ | Fast | Good |
| **mistral** | 4GB | ⭐⭐⭐⭐ | Fast | Good |
| **llama2** | 3.8GB | ⭐⭐⭐ | Medium | Fair |
| **dolphin-mixtral** | 26GB | ⭐⭐⭐⭐⭐ | Slow | Excellent |

**Recommendation:** `neural-chat` (best balance of quality, speed, size)

#### Deployment Path

**Development:** Local Ollama on developer machine ✅  
**Staging:** Docker container with Ollama + GPU  
**Production:** Ollama on dedicated GPU server or cluster

---

### 2. OPENROUTER (API Aggregator)

#### Overview
Proxy API that provides access to 100+ models from different providers. Mix of free and paid models.

#### Compatibility with Requirements

| Requirement | Status | Details |
|---|---|---|
| LangGraph (Python) | ✅ YES | Via `langchain-openai` (compatible) |
| FastAPI | ✅ YES | Standard HTTP API |
| Free/Developer | ⚠️ LIMITED | Free tier with $5 credit |
| Assignment reasoning | ✅ GOOD | Access to high-quality models |
| Latency | ✅ FAST | 500ms-2s (cloud-based) |

#### Setup

```bash
# 1. Create account at openrouter.ai
# 2. Get API key
# 3. Set environment
export OPENROUTER_API_KEY="sk-or-..."
```

#### LangChain Integration

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="meta-llama/llama-2-70b-chat",  # Free model
    api_key="sk-or-...",
    base_url="https://openrouter.ai/api/v1",
    temperature=0.7,
)

response = llm.invoke("Select best executive for hot lead")
```

#### LangGraph Integration

```python
from langgraph.graph import StateGraph
from langchain_openai import ChatOpenAI

class AssignmentAgent:
    def __init__(self, api_key: str):
        self.llm = ChatOpenAI(
            model="meta-llama/llama-2-70b-chat",
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
        )
        self.graph = self._build_graph()
    
    async def _select_executive_node(self, state):
        response = await self.llm.ainvoke(prompt)
        return {...}
```

#### Free Models Available

| Model | Provider | Quality | Speed | Notes |
|---|---|---|---|---|
| `meta-llama/llama-2-70b-chat` | Meta | ⭐⭐⭐⭐ | Medium | Good reasoning |
| `mistralai/mistral-7b-instruct` | Mistral | ⭐⭐⭐⭐ | Fast | Small, capable |
| `mistralai/mistral-medium` | Mistral | ⭐⭐⭐⭐⭐ | Medium | Excellent reasoning |
| `nvidia/llama-2-70b` | NVIDIA | ⭐⭐⭐⭐ | Slow | Optimized version |

#### Pricing (Free Tier)

- **Free tier:** $5 credit (~250k tokens with Llama 2)
- **Per-token:** $0.00002 input, $0.00006 output (Llama 2-70b)
- **Monthly estimate (Assignment Agent):**
  - ~100 assignments/day × 2000 tokens = 200k tokens/month
  - Cost: $0.02 (essentially free)

#### Pros
- ✅ **Multiple models** — 100+ to choose from
- ✅ **Easy switching** — Change model with single config change
- ✅ **Reasonable free tier** — $5 credit for testing
- ✅ **Good fallback chain** — Can try multiple models
- ✅ **No hardware required** — Cloud-based
- ✅ **Vendor-independent** — Not locked to one provider
- ✅ **Good documentation** — OpenRouter is well-documented

#### Cons
- ⚠️ **Limited free tier** — $5 credit (runs out quickly if heavily used)
- ⚠️ **Requires API key** — External dependency
- ❌ **Latency** — Cloud-based (500ms-2s)
- ⚠️ **Model consistency** — Quality varies by model

#### Fallback Strategy

```python
FALLBACK_MODELS = [
    "mistralai/mistral-medium",     # Best reasoning
    "meta-llama/llama-2-70b-chat",  # Good backup
    "mistralai/mistral-7b-instruct", # Fast backup
]

async def _select_executive_with_fallback(self, state):
    for model in FALLBACK_MODELS:
        try:
            self.llm.model_name = model  # Switch model
            return await self.llm.ainvoke(prompt)
        except Exception as e:
            logger.warning(f"Model {model} failed, trying next...")
            continue
```

#### Deployment Path

**Development:** Use free tier with Llama 2-70b ✅  
**Staging:** Same (free tier sufficient)  
**Production:** Upgrade to paid tier ($0.02-0.10 per assignment)

---

### 3. GROQ (Fast Inference)

#### Overview
Groq's LPU (Language Processing Unit) provides extremely fast inference. Free tier available.

#### Compatibility with Requirements

| Requirement | Status | Details |
|---|---|---|
| LangGraph (Python) | ✅ YES | Via `langchain-groq` |
| FastAPI | ✅ YES | Standard REST API |
| Free/Developer | ⚠️ LIMITED | Free tier with rate limits |
| Assignment reasoning | ⭐⭐⭐ FAIR | Good for simple logic |
| Latency | ✅ FAST | 50-300ms (extremely fast) |

#### Setup

```bash
# 1. Create account at console.groq.com
# 2. Get API key
# 3. Set environment
export GROQ_API_KEY="gsk_..."
```

#### LangChain Integration

```python
from langchain_groq import ChatGroq

llm = ChatGroq(
    model="mixtral-8x7b-32768",
    api_key="gsk_...",
    temperature=0.7,
)

response = llm.invoke("Select best executive for hot lead")
```

#### Free Models Available

| Model | Quality | Speed | Notes |
|---|---|---|---|
| `mixtral-8x7b-32768` | ⭐⭐⭐⭐ | ⚡ Ultra-fast | Excellent reasoning |
| `llama2-70b-4096` | ⭐⭐⭐⭐ | ⚡ Ultra-fast | Good all-rounder |
| `gemma-7b-it` | ⭐⭐⭐ | ⚡ Ultra-fast | Smaller model |

#### Free Tier Limits

- **Requests:** 30 per minute
- **Tokens:** 6,000 per minute
- **Requests/day:** ~40,000 (more than enough for 100 assignments/day)
- **Cost:** Free (with limits)

#### Pros
- ✅ **Extremely fast** — 50-300ms latency (best-in-class)
- ✅ **Reasonable free tier** — 30 requests/min sufficient
- ✅ **Good models** — Mixtral-8x7b is excellent
- ✅ **No hardware required** — Cloud-based
- ✅ **Latency critical** — Best for real-time use cases

#### Cons
- ⚠️ **Limited free tier** — 30 requests/min (might hit limits under load)
- ⚠️ **Fewer models** — Only 3-4 options
- ⚠️ **Rate limiting** — Free tier has strict limits
- ⚠️ **Less flexibility** — No model switching like OpenRouter

#### Deployment Path

**Development:** Free tier sufficient ✅  
**Staging:** Same  
**Production:** Upgrade to paid tier (still free for small usage)

---

### 4. NVIDIA NIM (Enterprise)

#### Overview
NVIDIA's containerized AI inference service. Self-hosted or cloud-hosted. Enterprise-focused.

#### Compatibility with Requirements

| Requirement | Status | Details |
|---|---|---|
| LangGraph (Python) | ✅ YES | Via REST API integration |
| FastAPI | ✅ YES | HTTP API |
| Free/Developer | ⚠️ LIMITED | Free tier available but limited |
| Assignment reasoning | ✅ GOOD | Access to Meta models |
| Latency | ✅ FAST | Depends on hardware |

#### Setup (Simplified)

```bash
# Option 1: Cloud-hosted (easier)
# Use NVIDIA API at api.nvcf.nvidia.com

# Option 2: Self-hosted (requires NVIDIA GPU)
# Docker pull nvcr.io/nim/meta-llama2-70b
# docker run --gpus all nvcr.io/nim/meta-llama2-70b
```

#### Free Tier

- **Cloud API:** Limited free access
- **Self-hosted:** Free, but requires NVIDIA hardware
- **Support:** Community support

#### Pros
- ✅ **Enterprise-grade** — Production-ready infrastructure
- ✅ **Self-hosted option** — Full control
- ✅ **Good models** — Access to Meta Llama 2
- ✅ **Optimization** — NVIDIA-optimized inference

#### Cons
- ❌ **Complex setup** — Requires NVIDIA account, container knowledge
- ❌ **Hardware requirements** — GPU needed for self-hosting
- ⚠️ **Limited free tier** — Cloud API has strict limits
- ❌ **Overkill for MVP** — Enterprise solution for simple agent

---

### 5. TOGETHER.AI (Development)

#### Overview
Unified API for open-source models. Free tier with credits.

#### Compatibility with Requirements

| Requirement | Status | Details |
|---|---|---|
| LangGraph (Python) | ✅ YES | Via `langchain-together` |
| FastAPI | ✅ YES | Standard API |
| Free/Developer | ⚠️ LIMITED | $25 free credit |
| Assignment reasoning | ⭐⭐⭐ FAIR | Good models available |
| Latency | ✅ GOOD | 1-3s typical |

#### LangChain Integration

```python
from langchain_community.llms import Together

llm = Together(
    model="meta-llama/Llama-2-70b-chat-hf",
    together_api_key="xxxx",
    temperature=0.7,
)

response = llm.invoke("Select best executive")
```

#### Free Tier

- **Credit:** $25 free credit
- **Models:** 100+
- **Cost:** Variable per model (~$0.0002 per token for Llama 2)

#### Pros
- ✅ **Good free tier** — $25 credit
- ✅ **Many models** — Easy switching
- ✅ **Community-friendly** — Open-source focused

#### Cons
- ⚠️ **Limited documentation** — Less official support
- ⚠️ **Latency** — Slower than Groq
- ⚠️ **Free tier limited** — $25 runs out fairly quickly

---

## Recommendation Matrix

### For Development Environment

```
Priority: Cost & Ease of Use
┌─────────────────────────────────────┐
│ 1. OLLAMA (Best)                    │
│    • Zero cost                      │
│    • Local (offline capable)        │
│    • Perfect for dev testing        │
│    • Easy model switching           │
│                                     │
│ 2. OpenRouter (Good)                │
│    • $5 free tier                   │
│    • Model flexibility              │
│    • Easy fallback chain            │
│                                     │
│ 3. Groq (Fast)                      │
│    • Free tier with limits          │
│    • Ultra-fast responses           │
│    • Good for latency-sensitive     │
└─────────────────────────────────────┘
```

### For Production Environment

```
Priority: Reliability & Scalability
┌─────────────────────────────────────┐
│ 1. OpenRouter + Ollama (Hybrid)    │
│    • OpenRouter for cloud failover  │
│    • Ollama as primary (cost save)  │
│    • Best fallback chain            │
│                                     │
│ 2. Groq (Speed-Critical)            │
│    • Ultra-fast response times      │
│    • Good free tier                 │
│    • Sufficient for assignment use  │
│                                     │
│ 3. Together.AI (Budget)             │
│    • Cost-effective                 │
│    • Good model selection           │
└─────────────────────────────────────┘
```

---

## FINAL RECOMMENDATION

### 🏆 PRIMARY RECOMMENDATION: **Hybrid Approach (Ollama + OpenRouter)**

#### Development
```
Assignment Agent
    ├─ Primary: Ollama (local, free)
    └─ Fallback: OpenRouter (if needed)
```

**Why:**
- ✅ Zero cost for main development path
- ✅ Fast iteration (no API latency during development)
- ✅ Privacy (data stays local)
- ✅ Offline capable
- ✅ Can fallback to cloud if Ollama fails

#### Production
```
Assignment Agent
    ├─ Primary: Ollama (self-hosted, on GPU)
    ├─ Secondary: OpenRouter (cloud fallback)
    └─ Tertiary: Groq (speed backup)
```

**Why:**
- ✅ Primary source on-premises (cost control)
- ✅ Cloud fallback for reliability
- ✅ Groq for speed/latency requirements
- ✅ Cost: ~$0.02/month (negligible)

---

### 🎯 ALTERNATIVE RECOMMENDATION: **OpenRouter Only (Simplest)**

**If you want simplicity over cost:**

```
Assignment Agent
    ├─ Primary: OpenRouter (Mistral Medium)
    └─ Fallback: OpenRouter (Llama 2-70b)
```

**Why:**
- ✅ Single provider (no complexity)
- ✅ Easy model switching
- ✅ Fallback chain built-in
- ✅ No infrastructure required
- ❌ Cost: ~$0.02-0.10 per assignment (still cheap)

---

### 🚀 SPEED OPTIMIZATION: **Groq Only (Latency-Sensitive)**

**If real-time response is critical:**

```
Assignment Agent
    └─ Primary: Groq (Mixtral-8x7b)
```

**Why:**
- ✅ 50-300ms latency (best-in-class)
- ✅ Sufficient free tier
- ✅ Excellent model (Mixtral)
- ❌ Less flexibility than OpenRouter

---

## Configuration Changes Required

### Option 1: Ollama (Primary Recommendation)

**Dependencies to add:**
```txt
langchain-community>=0.1.0  # For Ollama support
ollama                      # Python client (optional)
```

**Code changes in `agents.py`:**
```python
from langchain_community.llms import Ollama

class AssignmentAgent:
    def __init__(self, db: Database, ollama_url: str = "http://localhost:11434"):
        self.llm = Ollama(
            model="neural-chat",
            base_url=ollama_url,
            temperature=0.7,
        )
        # Rest of code unchanged
```

**Environment variables:**
```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=neural-chat
```

**Production deployment:**
- Docker image with Ollama pre-loaded
- GPU allocation in Kubernetes
- Model caching strategy

---

### Option 2: OpenRouter (Simplest Production)

**Dependencies to add:**
```txt
langchain-openai>=0.1.0  # Compatible with OpenRouter
```

**Code changes in `agents.py`:**
```python
from langchain_openai import ChatOpenAI

class AssignmentAgent:
    def __init__(self, db: Database, api_key: str):
        self.llm = ChatOpenAI(
            model="meta-llama/llama-2-70b-chat",
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            temperature=0.7,
        )
        # Rest of code unchanged
```

**Environment variables:**
```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-2-70b-chat
```

---

### Option 3: Groq (Speed Optimized)

**Dependencies to add:**
```txt
langchain-groq>=0.1.0
```

**Code changes in `agents.py`:**
```python
from langchain_groq import ChatGroq

class AssignmentAgent:
    def __init__(self, db: Database, api_key: str):
        self.llm = ChatGroq(
            model="mixtral-8x7b-32768",
            api_key=api_key,
            temperature=0.7,
        )
        # Rest of code unchanged
```

**Environment variables:**
```bash
GROQ_API_KEY=gsk_...
GROQ_MODEL=mixtral-8x7b-32768
```

---

## Comparison Table

| Aspect | Ollama | OpenRouter | Groq | Together | NVIDIA |
|--------|--------|-----------|------|----------|--------|
| **Cost** | Free | $0.02/mo | Free | $25 credit | Free |
| **Setup** | Easy | Very easy | Easy | Easy | Complex |
| **Latency** | 50-500ms | 500-2000ms | 50-300ms | 1-3s | Variable |
| **Models** | 10+ | 100+ | 3-4 | 100+ | Limited |
| **Hardware** | GPU needed | None | None | None | GPU needed |
| **Fallback** | Manual | Built-in | Built-in | Built-in | Limited |
| **Production** | Complex | Easy | Easy | Easy | Complex |
| **Free tier** | Unlimited | $5 | 30req/min | $25 | Limited |

---

## Summary

### For Nissan Project Assignment Agent:

**🥇 RECOMMENDED: Ollama (Development) + OpenRouter (Production)**
- Best combination of cost and reliability
- Ollama for fast local iteration
- OpenRouter cloud as failover
- Seamless integration with LangGraph

**🥈 ALTERNATIVE: OpenRouter Only**
- Simplest to implement
- Single provider
- Flexible model selection
- Negligible cost

**🥉 SPEED-FOCUSED: Groq Only**
- If latency is critical (<500ms required)
- Ultra-fast inference
- Good free tier
- Limited model options

---

## Next Steps (When Ready to Implement)

1. **Choose provider** — Select from recommendations above
2. **Install dependencies** — Add to `apps/api/requirements.txt`
3. **Update `agents.py`** — Replace Anthropic client with chosen provider
4. **Update config** — Add environment variables
5. **Test locally** — Verify assignment workflow
6. **Update documentation** — Document new provider setup
7. **Deploy** — Container/production setup for chosen provider

---

**Ready to implement when you approve the provider choice.**
