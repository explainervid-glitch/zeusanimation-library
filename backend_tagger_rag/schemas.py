from pydantic import BaseModel, Field
from typing import List, Optional

class MetadataBackground(BaseModel):
    asset_type: Optional[str] = Field(default=None, description="Auto-set by system, AI skip")
    style: Optional[str] = Field(default=None, description="AI skip, leave empty/null")
    mood: str = Field(..., description="Atmospheric tone")
    lighting: str = Field(..., description="Lighting condition")
    time_of_day: str = Field(..., description="e.g., 'day', 'night', 'dusk'")
    props: List[str] = Field(default_factory=list)
    roles: List[str] = Field(default_factory=list)
    duration_sec: int = 0

class MetadataCharacter(BaseModel):
    asset_type: Optional[str] = Field(default=None, description="Auto-set by system, AI skip")
    style: Optional[str] = Field(default=None, description="AI skip, leave empty/null")
    vibe: str = Field(..., description="Personality/vibe")
    gender: str = Field(..., description="e.g., 'male', 'female', 'neutral'")
    age: str = Field(..., description="e.g., 'adult', 'teen', 'child'")
    props: List[str] = Field(default_factory=list)
    roles: List[str] = Field(default_factory=list)
    duration_sec: int = 0

class SearchContext(BaseModel):
    scene_prompt: str = Field(..., description="Natural language prompt for generation/search")
    keywords: List[str] = Field(..., description="Mixed EN/ID keywords for RAG retrieval")

class AssetBackground(BaseModel):
    FileName: str
    Detail: str
    Category: str
    description: dict = Field(default_factory=lambda: {"full": ""})
    metadata: MetadataBackground
    search_context: SearchContext

class AssetCharacter(BaseModel):
    FileName: str
    Detail: str
    Category: str
    description: dict = Field(default_factory=lambda: {"full": ""})
    metadata: MetadataCharacter
    search_context: SearchContext

class InspirationMetadata(BaseModel):
    mood:         str       = ""
    roles:        list[str] = []
    asset_type:   str       = "inspiration"

class InspirationDescription(BaseModel):
    full: str = ""

class InspirationSearchContext(BaseModel):
    scene_prompt: str       = ""
    keywords:     list[str] = []

class AssetInspiration(BaseModel):
    FileName:       str                        = ""
    Detail:         str                        = ""
    Category:       str                        = ""
    description:    InspirationDescription     = InspirationDescription()
    metadata:       InspirationMetadata        = InspirationMetadata()
    search_context: InspirationSearchContext   = InspirationSearchContext()

class AnimationDescription(BaseModel):
    short: str = ""
    full:  str = ""

class AnimationMetadata(BaseModel):
    mood:         str       = ""
    action:       str       = ""
    loopable:     bool      = False
    duration_sec: float     = 0.0
    asset_type:   str       = "animation"
    roles:        list[str] = []

class AnimationSearchContext(BaseModel):
    scene_prompt: str       = ""
    keywords:     list[str] = []

class AssetAnimation(BaseModel):
    FileName:       str                    = ""
    Detail:         str                    = ""
    Category:       str                    = ""
    description:    AnimationDescription   = AnimationDescription()
    metadata:       AnimationMetadata      = AnimationMetadata()
    search_context: AnimationSearchContext = AnimationSearchContext()