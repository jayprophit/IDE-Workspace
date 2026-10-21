# Aetherius IDE

The interface to the Aetherius OS stack. It runs on top of two services
that have to be up first:

```
Ollama  ->  Agent Bridge  ->  Aetherius IDE
```

- **Ollama** serves the local models.
- **Agent Bridge** is the execution runtime. The IDE talks to it and to
  nothing else.
- **Aetherius IDE** is the interface. It never talks to a model directly.

## Running it

```powershell
cd "C:\Users\jpowe\Desktop\Projects\Aetherius-OS"
powershell -ExecutionPolicy Bypass -File scripts\start-ide-stack.ps1
```

Then open <http://127.0.0.1:5199>.

The launcher starts each service only if it is not already running, waits
for it, and prints what is actually true. It is the only supported way
to start the stack, because the Bridge has to be given the IDE's origin
explicitly or it sends no CORS header and the IDE reports itself
disconnected.

**The full instructions, including what to do when each step fails, are
in [`HOW-TO-RUN-AETHERIUS-IDE.md`](../../HOW-TO-RUN-AETHERIUS-IDE.md).**
That document is the authority on how to run this, and it was written
against the running stack rather than from the source.

## What you should see

| In the IDE | Means |
|---|---|
| `backend: connected (HEALTHY)` | the IDE reached the Bridge |
| `Models (10)` | the Bridge reached the local models |
| `model: no model connected` | no model is *selected* yet — correct and honest until you pick one |
| `agent: no agent connected` | no agent is running yet |
| `workers: 0 registered` | the Bridge has no live worker roster endpoint yet — a known gap, not a fault |

A connected backend with no models means the model runtime is down, not
that the IDE is broken.

## Working in this repository

```powershell
cd workspace\app
npm install      # first time only
npm run dev      # the development server on 127.0.0.1:5199
npm run build    # type check and production build
npm test         # the test suite
npm run test:all # the suite plus the bridge integration tests
```

The application lives in `workspace/app`. `build.yaml` is the build
manifest, and the registry that says where this project lives is
`docs/BUILD-MANIFEST-REGISTRY.yaml` in the Aetherius-OS repository.

## The two entry points

| URL | What it is |
|---|---|
| `http://127.0.0.1:5199/` | the IDE |
| `http://127.0.0.1:5199/genesis-ui.html` | the standalone Genesis scaffold |

The scaffold defaults to **fixture mode**, which is labelled as such and
cannot present fixture data as live. See
`workspace/app/src/genesis-ui/docs/RUNTIME_BINDING.md` for the binding
and the honesty rules it enforces.

## What it will not do

The IDE reports what it can actually see. It does not synthesise a
connected backend, a selected model, a running agent or a passing
verification. A field reading "no agent connected" means there is no
agent connected, not that the interface failed to look.
