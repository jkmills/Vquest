from pydantic import BaseModel
from typing import Optional


class PlayerJoin(BaseModel):
    name: str


class Player(BaseModel):
    id: str
    name: str


class Action(BaseModel):
    player_id: str
    text: str


class Vote(BaseModel):
    player_id: str
    choice: int


class Prompt(BaseModel):
    text: str
    need_roll: bool = False
    roll_type: Optional[str] = None
