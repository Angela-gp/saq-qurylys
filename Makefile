.PHONY: install run seed test frontend lint build

install:
	python -m pip install -r requirements.txt
	cd frontend && npm install

run:
	python -m uvicorn backend.app.main:app --reload

seed:
	python -m backend.seed.seed

test: build
	python -m pytest backend/tests -q
	cd frontend && npm test -- --run

lint:
	ruff check backend/app backend/seed backend/tests
	cd frontend && npm run lint

build:
	cd frontend && npm run build

frontend:
	cd frontend && npm run dev
