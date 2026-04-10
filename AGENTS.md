# BookSmart Repo Instructions

## Purpose
This repo powers BookSmart, an AI booking and triage assistant for a home service company.

## Core Rules
- Preserve existing Housecall Pro booking behavior unless a defect is identified
- Housecall Pro is the source of truth for availability and booking outcomes
- Business rules must come from structured config, not giant prompt text
- The AI must never invent availability, pricing, or booking outcomes
- Phone number is the primary customer identity key
- Photos are optional assistive in v1, not required
- The customer-facing experience should feel simple and invisible
- The internal operator console controls routing/config behavior

## Architecture Preferences
- Use TypeScript
- Use adapters for external systems
- Use typed tool wrappers between AI and business logic
- Keep Blooio transport separate from HCP adapter logic
- Keep prompts compact
- Keep business logic in code + config
- Add tests for critical booking and urgency flows

## Development Style
- Refactor incrementally
- Do not rewrite stable working code without cause
- Document assumptions and fragile areas
- Prefer modular files and typed interfaces
- Keep the system production-oriented and maintainable

## Master Prompt
You are working inside an existing Vercel project that already contains working Housecall Pro booking/availability logic built with Codex.

Your job is to evolve this project into BookSmart: a production-ready AI booking assistant for a home service company.

High-level objective:
Build BookSmart as a customer-facing booking + triage assistant with an internal operator console. Preserve the existing HCP booking engine as the source of truth. Do not rebuild working HCP logic from scratch unless a clear defect is found. Refactor around it, wrap it, and harden it.

Core architecture:
- Existing HCP integration remains the booking engine and source of truth
- Add Blooio messaging transport via webhooks and outbound messaging
- Add OpenAI Responses API orchestration with tool calling
- Add structured conversation state persistence
- Add internal operator console for structured configuration
- Keep customer-facing complexity invisible
- Do not put business rules inside a giant editable prompt
- Business rules must come from structured config in the database

Technical preferences:
- Use TypeScript
- Keep the app inside the existing Vercel project
- Preserve current working behavior where possible
- Refactor for modularity and maintainability
- Favor clean adapters and typed interfaces
- Add tests for critical flows
- Use env vars for secrets only
- Use database-backed config for editable internal behavior

Primary product behavior:
BookSmart v1 must be able to:
- receive customer messages from Blooio
- ask brief questions one at a time
- qualify service area
- identify service type
- detect urgency
- collect customer info
- check real availability using existing HCP logic
- offer real slots
- book jobs into HCP
- confirm bookings
- hand off when needed

V1 must handle:
- standard service calls
- estimate requests
- urgent/emergency-style calls

Do NOT build v1 as:
- a broad FAQ chatbot
- a pricing/quoting engine
- a giant knowledge base assistant
- a freeform editable prompt playground

Important business rules:
- HCP is the source of truth for availability and bookings
- Phone number is the primary customer identity key
- Photos are optional assistive, never required to complete booking in v1
- Availability selection is HCP-first for v1
- The AI must never invent availability, pricing, or booking outcomes
- The AI must ask one question at a time
- The AI must be brief, warm, confident, and operationally focused

Conversation priorities:
1. identify the job type
2. detect urgency
3. collect city/address/contact
4. get real availability
5. book
6. confirm
7. escalate when needed

Opening conversation behavior:
Default opening question:
"What city is the project in?"

Then determine service type, then collect address and contact info, then ask morning or afternoon preference, then present 2-3 real slots returned from HCP, then confirm booking.

Urgency handling:
Urgent/safety-critical signals include:
- burning smell
- sparks
- arcing
- hot panel
- partial outage with safety concern
- service mast issue
- meter issue
- unsafe panel condition

For urgent issues:
- mark urgency appropriately
- prioritize earliest available path
- escalate to human or urgent routing if rules require it
- do not continue as a normal job when rules indicate escalation

V1 service types to support:

Standard service calls:
- outlet_switch_issue
- breaker_tripping
- flickering_lights
- power_loss_partial
- fixture_repair_or_replace
- troubleshooting_general
- dedicated_circuit
- smoke_co_detector
- outdoor_receptacle
- fan_or_fixture_install

Estimate-type jobs:
- ev_charger_install
- panel_upgrade
- service_upgrade
- remodel_project
- recessed_lighting_add
- whole_home_rewire
- generator_or_interlock
- subpanel_install
- surge_protection_upgrade
- smart_home_or_lutron

Urgent jobs:
- burning_smell
- sparks_or_arcing
- hot_panel
- emergency_power_issue
- service_mast_or_meter_issue
- unsafe_panel_condition

V1 technician skill tags:
- service_calls
- troubleshooting
- panel_work
- ev_chargers
- lighting
- remodel_estimates
- generators
- smart_home

Service-type behavior guidance:
- Each service type must map to a category: service_call, estimate, or urgent
- Each service type must map to required skill tags
- Some service types should recommend photo upload, but not require it
- Booking/routing behavior must be driven by structured config, not hard-coded prompt logic

Operator console requirements:
Build an internal operator console under /admin (or equivalent internal route) for internal use only.

The operator console should allow editing of:
1. technicians
   - name
   - active/inactive
   - role
   - default priority
2. technician skills
3. service types
   - display name
   - category
   - required skills
   - photo request setting
   - priority level
4. HCP service mappings
5. service areas
   - cities
   - zip codes
   - premium zones
   - restricted zones
   - after-hours zones
   - outside-area behavior
6. urgency keywords and urgency levels
7. booking rules
   - same-day allowed
   - minimum notice
   - morning/afternoon settings
   - senior-only conditions
   - estimate rules
8. conversation settings
   - opening question
   - office hours
   - after-hours behavior
   - when to request photos
   - handoff behavior

Important:
The operator console should edit structured settings in the database, not giant raw prompts.

Database/config expectations:
Introduce a structured config/state layer.

Suggested tables/models:
- technicians
- technician_skills
- service_types
- service_type_skill_requirements
- hcp_service_mappings
- service_areas
- urgency_keywords
- booking_rules
- conversation_settings
- conversations
- contacts
- bookings or booking_events
- handoff_events

Conversation state should persist:
- phone
- name
- email if provided
- city
- zip
- address
- service type
- urgency
- preferred window
- booking status
- transcript
- lead source
- handoff state

Adapter architecture:
Refactor the existing HCP logic into a dedicated adapter layer without changing behavior unless necessary.

Target structure should resemble:
- src/adapters/hcp/
- src/tools/
- src/flows/
- src/channels/blooio/
- src/prompts/
- src/types/
- src/db/ or equivalent

Create a stable HCP adapter interface with functions like:
- getAvailability(input)
- findOrCreateCustomer(input)
- createBooking(input)

The AI/orchestration layer must not call raw HCP code directly. It should call typed wrapper tools.

Tool layer:
Create typed wrapper tools for the model such as:
- check_service_area
- classify_service_type
- get_availability
- find_or_create_customer
- create_booking
- handoff_to_human
- request_photo

These tools should return normalized JSON objects, not HCP-native raw shapes.

Blooio integration:
Add inbound webhook handling and outbound message sending.
Requirements:
- verify webhook signatures if applicable
- normalize inbound payloads
- support idempotency / duplicate event protection
- log raw inbound events for debugging
- send outbound replies through a clean abstraction

OpenAI orchestration:
Use the OpenAI Responses API with tool calling.
Build a system prompt that keeps the assistant:
- brief
- warm
- confident
- operational
- one-question-at-a-time
- never inventing availability, pricing, or booking outcomes

Do not build giant prompt logic where business rules live in prose. The system prompt should stay compact, and dynamic behavior should come from tools + database config.

Behavioral examples:
- For service area qualification, ask city first
- For availability, ask morning or afternoon before looking up slots
- Present a small number of real slot options
- For photos, say they help prepare before arrival but do not block booking
- For urgent issues, route according to urgency rules
- For unsupported or failed flows, hand off cleanly

Acceptance criteria for v1:
The implementation is successful when:
1. a customer can start a chat through Blooio
2. BookSmart asks city first
3. BookSmart identifies one of the supported service types
4. BookSmart detects urgent language appropriately
5. BookSmart collects address and contact info
6. BookSmart checks real availability through the existing HCP engine
7. BookSmart offers real slots
8. BookSmart books correctly into HCP
9. BookSmart confirms the booking
10. operator console edits can change live behavior without code changes
11. HCP remains the source of truth
12. critical flows are covered by tests

Testing requirements:
Add tests for at least:
- standard service-call booking
- estimate booking
- urgent issue routing
- outside service area handling
- duplicate customer by phone
- webhook duplicate/idempotency handling
- HCP tool failure fallback
- operator console config affecting routing

Execution instructions:
1. First inspect the existing repo and identify current HCP booking/availability/customer logic.
2. Do not rewrite working logic prematurely.
3. Refactor the HCP code into adapters.
4. Then build the tool layer.
5. Then build conversation state and orchestration.
6. Then add Blooio channel support.
7. Then build the operator console.
8. Then add tests and documentation.
9. Keep changes incremental and explain assumptions.
10. If something in the existing code is fragile or ambiguous, document it clearly before changing behavior.

Output expectations:
- Make the codebase modular and production-oriented
- Preserve existing successful HCP behavior where possible
- Add documentation for architecture, config, and setup
- Summarize what was preserved, what was refactored, and any risks or follow-ups
