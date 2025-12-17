-- Criar tabela de campanhas de votação
CREATE TABLE IF NOT EXISTS campaign_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    campaign_details TEXT,
    launch_period VARCHAR(100) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Criar tabela de respostas das campanhas
CREATE TABLE IF NOT EXISTS campaign_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaign_surveys(id) ON DELETE CASCADE,
    franchisee_id UUID NOT NULL REFERENCES franchisees(id),
    regional_user_id UUID,
    city_id UUID NOT NULL REFERENCES cities(id),
    vote VARCHAR(20) DEFAULT 'accepted',
    observations TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(campaign_id, franchisee_id)
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_campaign_surveys_status ON campaign_surveys(status);
CREATE INDEX IF NOT EXISTS idx_campaign_responses_campaign_id ON campaign_responses(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_responses_franchisee_id ON campaign_responses(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_campaign_responses_city_id ON campaign_responses(city_id);
