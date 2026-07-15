import { EventBus } from "../events/event-bus";
import type { ProviderEvent, TraceEvent } from "../events/schema";
import {
  mapAssistantCompleted,
  mapAssistantDelta,
  mapLegacyTraceEvent,
  mapThinkingCompleted,
  mapThinkingDelta,
  type MappingContext,
} from "../events/legacy-map";
import type { StreamEvent } from "../trace";

export class AgentEventSink {
  private activeTextId: string | undefined;
  private activeThinkingId: string | undefined;
  private readonly mappingContext: MappingContext;

  constructor(
    private readonly eventBus: EventBus,
    private readonly streamKey: string,
    runId: string,
    sessionId: string,
  ) {
    this.mappingContext = { runId, sessionId };
  }

  publishTrace(event: TraceEvent) {
    this.eventBus.publish(this.streamKey, event, { durable: true });
  }

  publishLive(event: ProviderEvent) {
    this.eventBus.publish(this.streamKey, event, { durable: false });
  }

  startText(stepId: string, stepIndex: number) {
    const textId = crypto.randomUUID();
    this.activeTextId = textId;
    this.publishTrace({
      ...this.mappingContext,
      stepId,
      stepIndex,
      textId,
      type: "text.started",
    });
    return textId;
  }

  startThinking(stepId: string, stepIndex: number) {
    const thinkingId = crypto.randomUUID();
    this.activeThinkingId = thinkingId;
    this.publishTrace({
      ...this.mappingContext,
      stepId,
      stepIndex,
      thinkingId,
      type: "thinking.started",
    });
    return thinkingId;
  }

  emit(event: StreamEvent) {
    switch (event.type) {
      case "assistant_delta":
        if (this.activeTextId) {
          this.publishLive(
            mapAssistantDelta(event, this.mappingContext, this.activeTextId),
          );
        }
        return;
      case "thinking_delta":
        if (this.activeThinkingId) {
          this.publishLive(
            mapThinkingDelta(
              event,
              this.mappingContext,
              this.activeThinkingId,
            ),
          );
        }
        return;
      case "assistant":
        if (this.activeTextId) {
          this.publishTrace(
            mapAssistantCompleted(event, this.mappingContext, this.activeTextId),
          );
        }
        return;
      case "thinking":
        if (this.activeThinkingId) {
          this.publishTrace(
            mapThinkingCompleted(
              event,
              this.mappingContext,
              this.activeThinkingId,
            ),
          );
        }
        return;
      default: {
        const trace = mapLegacyTraceEvent(event, this.mappingContext);
        if (trace) this.publishTrace(trace);
      }
    }
  }
}
