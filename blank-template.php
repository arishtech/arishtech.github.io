<?php
/**
*Template Name: Blank Template 
*/

get_header();
if(get_post_meta( get_the_ID(), 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta( get_the_ID(), 'restly_metabox', true );
} else {
    $restly_commonMeta = array();
}
if(array_key_exists('restly_meta_enable_banner', $restly_commonMeta)){
    $restly_postBanner = $restly_commonMeta['restly_meta_enable_banner'];
}else{
    $restly_postBanner = true;
}

if(array_key_exists('restly_meta_custom_title', $restly_commonMeta)){
    $restly_customTitle = $restly_commonMeta['restly_meta_custom_title'];
}else{
    $restly_customTitle = '';
}
?>
<?php if($restly_postBanner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2>
				<?php 
				if(!empty($restly_customTitle)){
					echo esc_html($restly_customTitle);
				}else{
					the_title();
				}
				?>
				</h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
<?php endif; ?>
	<main id="primary" class="site-main content-area">
		<?php the_content(); ?>
	</main><!-- #main -->
<?php get_footer();
