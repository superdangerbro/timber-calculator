CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tree_id" uuid,
	"sha256" text NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "circumference_cm" double precision;--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "photos" jsonb;--> statement-breakpoint
CREATE INDEX "photos_tree_idx" ON "photos" USING btree ("tree_id");