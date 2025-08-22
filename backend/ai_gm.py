from typing import Optional


async def evaluate(prompt: str, context: str, roll: Optional[int] = None) -> dict:
    """Placeholder AI Game Master.

    For now this just echoes the prompt. Real implementation would call an LLM.
    """
    return {"next_prompt": f"AI says: {prompt}", "need_roll": False}
