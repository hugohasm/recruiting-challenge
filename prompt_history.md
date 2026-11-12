# Prompt history — Hugo Segoviano

## Tool(s) used

Codex GPT-6 Astra Max Level

## How much of the work was AI-assisted

Most of it

---

## Sessions

### Session 1 — Initial repo diagnosis and prioritization

**Prompt:**
```text
Lee README.md, EVALUATION.md y SUBMISSION.md del repositorio.
Quiero un diagnóstico inicial del proyecto.
Tambien corre el proyecto y verifica que esta funcionando correctamente. De no ser asi verifica que problemas tenemos para corregir.

Hazme una lista de:
- los defects más importantes
- cuáles son críticos para negocio y seguridad
- cuáles son los 3+ issues que deberíamos corregir primero
- qué feature elegiría y por qué
- qué documentación falta
- qué deuda técnica queda abierta

No hagas cambios todavía.
No hagas refactor grande.
Solo necesito un diagnóstico y una propuesta de prioridad.
```

**What the model returned:**
> It reviewed the repo, ran the app, checked health and dashboard behavior, and diagnosed the highest-risk issues without modifying files.

**What I accepted, rejected, or refined:**
> I accepted the diagnosis that the most important issues were tenant leakage, incorrect revenue math, and weak validation. I rejected the idea of treating visual polish as a priority. I also clarified that the app uses a demo-only header-based auth model, which is acceptable for the challenge but not production auth.

---

### Session 2 — Confirm the actual failures and business impact

**Prompt:**
```text
Hazme una lista de:
- los defects más importantes
- cuáles son críticos para negocio y seguridad
- cuáles son los 3+ issues que deberíamos corregir primero
- qué feature elegiría y por qué
- qué documentación falta
- qué deuda técnica queda abierta
```

**What the model returned:**
> It listed the critical issues and confirmed that the app exposed other merchants’ orders, stored unsafe customer_email values, and calculated net revenue incorrectly.

**What I accepted, rejected, or refined:**
> I accepted the risk ranking, but I pushed back later on the idea that the app could be considered production-safe after a “simple” fix. I insisted the real auth boundary still needed to be treated as demo-only.

---

### Session 3 — First code block: close cross-merchant leakage

**Prompt:**
```text
Haz el primer bloque de cambios en este repo.
Objetivo:
- cerrar la fuga de datos entre merchants
- asegurar que la lectura por ID solo devuelva pedidos del merchant autenticado
- si no pertenece al merchant, responde 404
- si el merchant del header no existe o es inválido, responde 401
- validar acceso propio, acceso cruzado y merchant desconocido

Reglas:
- no hagas feature extra
- no hagas refactor grande
- no toques la UI todavía
- deja cambios pequeños y claros

Después:
- ejecuta tests y compilación
- confirma que el acceso ajeno no funciona
```

**What the model returned:**
> It restricted reads by merchant in the DAL and route flow, added tests for cross-merchant access, and reported that 16 tests passed.

**What I accepted, rejected, or refined:**
> I accepted the fix but made sure the review language was honest: the app still relies on the demo header and is not production auth.

---

### Session 4 — Business question: is cross-merchant access still possible?

**Prompt:**
```text
Contestame lo siguiente:
- ¿un merchant A puede ver el pedido de B?
- ¿se responde 404 para pedido ajeno?
- ¿merchant desconocido da 401?
- ¿la app no expone datos de otros merchants?
```

**What the model returned:**
> It answered that cross-merchant reads no longer work for the merchant context, but called out that the demo header is still spoofable and not real identity-based auth.

**What I accepted, rejected, or refined:**
> I accepted the distinction between tenant isolation and true identity enforcement. I kept that caveat explicit in the review and docs.

---

### Session 5 — Second code block: net revenue and payload validation

**Prompt:**
```text
Haz el segundo bloque de cambios.

Objetivo:
- corregir revenue para que sea neto
- restar refunds de ventas
- evitar sumar devoluciones como ingreso
- validar payload de creación de orden

Reglas:
- validar email, amount, type, status
- rechazar input inválido con 400
- mantener la convención de centavos
- no cambies más scope que lo necesario

Después:
- ejecuta tests
- confirma que revenue se calcula correctamente
```

**What the model returned:**
> It fixed net revenue logic and added validation for email, amount, type, and status. It reported that 58 tests passed.

**What I accepted, rejected, or refined:**
> I accepted the fix and kept the scope limited. I later caught an edge case involving a newline in email validation and made sure the validation was tightened before closing the block.

---

### Session 6 — Regression tests for the bug classes

**Prompt:**
```text
Haz el tercer bloque.

Objetivo:
- añadir tests de regresión para la clase de bugs corregidos

Cubre:
- acceso cruzado entre merchants
- cálculo neto de revenue
- payload inválido
- merchant inexistente

Reglas:
- no hagas tests genéricos
- cubre la clase del bug
- corrige el comando de tests si falla con Node 20

Luego ejecuta:
- npm test
- npm run build
```

**What the model returned:**
> It expanded regression coverage and reported that the tests pass under Node 20.

**What I accepted, rejected, or refined:**
> I accepted the regression suite and then explicitly reintroduced the bugs in temp copies to verify the tests fail when the fixes are removed. That is the strongest evidence that the bug classes are covered.

---

### Session 7 — Verify that the regression tests really catch the bugs

**Prompt:**
```text
ok contesta las siguientes preguntas:
- ¿la prueba falla si se reintroduce el bug?
- ¿cubre el caso real?
- ¿no solo un “happy path”?
```

**What the model returned:**
> It reintroduced the known bugs in temporary copies and confirmed that the regression tests fail in the correct cases, including cross-merchant reads, revenue math errors, invalid amounts, and missing merchants.

**What I accepted, rejected, or refined:**
> I accepted the evidence. This was an important validation step because it moved the work above “looks good” and into “actually catches the bug class.”

---

### Session 8 — API documentation

**Prompt:**
```text
Haz el cuarto bloque.

Objetivo:
- documentar el contrato real de la API
- completar api.md
- dejar claro qué headers se usan
- qué query params existen
- qué errores devuelve cada endpoint
- qué formato de respuesta se espera
- qué es demo auth y qué no es production auth

Reglas:
- no inventes cosas
- documenta solo lo que realmente existe
- no hagas refactor grande
```

**What the model returned:**
> It updated docs/api.md with the actual headers, endpoint behavior, error codes, and the explicit limitation that the current auth model is demo-only.

**What I accepted, rejected, or refined:**
> I accepted the documentation update but kept the caveat: the app still uses a header-based demo auth model and is not production-grade identity enforcement.

---

### Session 9 — Feature C: search with filters

**Prompt:**
```text
Haz el quinto bloque.
Resuelve la feature del menú:
Feature C: Order search with filters

Reglas:
- no hagas más de una feature
- debe integrarse con el dashboard
- añade endpoint de búsqueda con filtros por:
  - customer email
  - status
  - type
  - date range
  - amount range
- decide paginación y orden
- añade UI mínima
- no hagas refactor general
- no cambies el modelo si no es necesario

Después:
- ejecuta tests
- ejecuta build
- prueba la app localmente
```

**What the model returned:**
> It implemented a search endpoint, UI, pagination, filter logic, and local validation, and reported that tests/build passed.

**What I accepted, rejected, or refined:**
> I accepted the feature as the selected one, but I kept the review honest: a search feature is valuable, but it should not distract from the more important data-integrity and security fixes already made.

---

## What Codex got wrong

### Example 1

- **The prompt:**
```text
Haz el primer bloque de cambios ... asegurando que el merchant del header no existe o es inválido, responde 401.
```
- **What Claude returned:** A quick fix that enforced merchant scoping in reads but did not explicitly keep the review honest about the fact that `X-Merchant-Id` is only a demo header and not real identity.
- **What was wrong with it (technically):** It treated the auth model as if the tenant boundary alone solved production identity risks. It did not preserve the important distinction between “merchant isolation in this demo system” and “real auth for production.”
- **How I caught it:** I realized the code enforced tenant isolation but did not address spoofability of the header. I checked the actual model and kept the caveat in the design review.
- **What I did instead:** I kept the fix but explicitly documented that the system still depends on a demo header and is not production-grade authentication.

### Example 2

- **The prompt:**
```text
Haz el segundo bloque de cambios ... validar payload de creación de orden
```
- **What Claude returned:** A broad validation solution that looked complete, but a later edge case showed a newline in an email field could still get through if the validation was not tightened enough.
- **What was wrong with it:** The initial validation was not fully aligned with the actual business contract and edge cases. It was close, but not complete.
- **How I caught it:** I reviewed the exact validation path and noticed the input rules were too permissive for malformed values.
- **What I did instead:** I tightened the validation and added regression coverage before closing the block.

### Example 3

- **The prompt:**
```text
Haz el quinto bloque ... Feature C: Order search with filters
```
- **What Claude returned:** A functional feature with search, filters, and UI integration that appeared complete.
- **What was wrong with it:** The feature was valuable, but it was easy to mistake the UI/search work as the primary engineering problem. It was not the most important issue compared with merchant isolation, revenue truth, and validation.
- **How I caught it:** I kept the scope discipline and reviewed the feature as a secondary change. I did not let it overshadow the more critical fixes.
- **What I did instead:** I kept the feature work limited, integrated it carefully, and retained the original data-integrity work as the real priority.

### Example 4

- **The prompt:**
```text
Haz el primer bloque ... ejecuta tests y compilación
```
- **What Claude returned:** It reported all tests pass without explicitly qualifying that the auth model is still demo-only and that the test suite validated the merchant header contract, not true user identity.
- **What was wrong with it:** It implied the fix was more complete than it was. The code fixed the demo-level tenant boundary, but not a real production auth boundary.
- **How I caught it:** I validated the behavior against the actual business model and required the caveat to stay visible in the final review.
- **What I did instead:** I kept the fix, but explicitly stated the remaining risk and did not overclaim production readiness.

---

## Final note

This prompt history is intentionally not polished. The rough edges, the re-prompts, and the honest risk statements are part of the signal. The goal was not to hide uncertainty; it was to show where I accepted a fix, where I rejected a bad one, and where I intentionally kept the scope bounded.
