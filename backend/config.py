NODE_TYPES = {
    "trauma_event": {
        "color": "#D32F2F",
        "icon": "alert-circle",
        "label": "Traumatic Event",
        "description": "A deeply distressing or disturbing experience that overwhelmed your ability to cope",
        "tooltip": "Examples: accident, loss, abuse, violence. These are often root events in your healing journey."
    },
    "trigger": {
        "color": "#F57C00", 
        "icon": "zap",
        "label": "Trigger",
        "description": "Something that reminds you of the trauma and causes a strong reaction",
        "tooltip": "Can be sights, sounds, smells, places, or situations that bring back traumatic memories"
    },
    "response": {
        "color": "#FBC02D",
        "icon": "activity", 
        "label": "Trauma Response",
        "description": "Your body's automatic reaction to perceived threat",
        "tooltip": "Fight (anger/aggression), Flight (escape/avoidance), Freeze (numbness/paralysis), or Fawn (people-pleasing)"
    },
    "symptom": {
        "color": "#7B1FA2",
        "icon": "alert-triangle",
        "label": "Symptom/Issue",
        "description": "Current problems you experience that may be rooted in trauma",
        "tooltip": "Physical (insomnia, pain), emotional (anxiety, depression), or behavioral (avoidance, isolation)"
    },
    "emotion": {
        "color": "#1976D2",
        "icon": "heart",
        "label": "Emotion/Feeling", 
        "description": "Specific emotions connected to your trauma or healing",
        "tooltip": "Naming emotions like fear, shame, anger, or hope can be therapeutic"
    },
    "belief": {
        "color": "#5D4037",
        "icon": "message-circle",
        "label": "Belief/Thought",
        "description": "Deep-seated beliefs that arose from trauma",
        "tooltip": "Often negative thoughts like 'I'm not safe' or 'It was my fault' that need addressing"
    },
    "coping": {
        "color": "#388E3C",
        "icon": "shield",
        "label": "Coping Mechanism",
        "description": "Actions or strategies you use to handle trauma or stress",
        "tooltip": "Can be healthy (exercise, therapy) or unhealthy (avoidance, substance use)"
    },
    "support": {
        "color": "#00796B",
        "icon": "users",
        "label": "Resource/Support",
        "description": "People, places, or things that provide support",
        "tooltip": "Therapist, friends, pets, spiritual practices, safe spaces"
    }
}

# Trauma-informed message templates
MESSAGES = {
    "welcome": "Welcome back to your safe space for reflection and healing.",
    "first_time": "Welcome to TrauMapp'd. This is your private space for mapping and understanding your experiences.",
    "session_expired": "Your session has expired for security. Please log in again.",
    "save_success": "Your map has been safely saved.",
    "delete_confirm": "This will remove this node and its connections. You can always recreate it later if needed.",
    "crisis_disclaimer": "If you're in crisis, please reach out for immediate help: Call 988 (Suicide & Crisis Lifeline) or 911."
}