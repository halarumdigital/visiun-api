-- Remove constraint unique da placa na tabela motorcycles
-- Permite cadastrar múltiplas motos com a mesma placa

-- Verifica e remove o índice único se existir
DO $$
BEGIN
    -- Tenta dropar o índice único (nome padrão do Prisma)
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'motorcycles'
        AND indexname = 'motorcycles_placa_key'
    ) THEN
        DROP INDEX motorcycles_placa_key;
        RAISE NOTICE 'Índice motorcycles_placa_key removido com sucesso';
    ELSE
        RAISE NOTICE 'Índice motorcycles_placa_key não encontrado';
    END IF;

    -- Verifica outros possíveis nomes de constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'motorcycles_placa_key'
        AND conrelid = 'motorcycles'::regclass
    ) THEN
        ALTER TABLE motorcycles DROP CONSTRAINT motorcycles_placa_key;
        RAISE NOTICE 'Constraint motorcycles_placa_key removida com sucesso';
    END IF;
END $$;

-- Lista índices restantes para confirmação
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'motorcycles';
